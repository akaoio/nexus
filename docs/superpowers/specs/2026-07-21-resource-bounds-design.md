# Resource bounds — design

**Date:** 2026-07-21
**Issue:** #9 (audit follow-up), chunk 3 — the last of it. The moderates that are all one question: **what happens when there is more of something than the code assumed?** No rate limiting anywhere · no connection or subscriber cap · SSE fan-out costing O(subscribers) serial DB reads · `fire()` full-scanning `nexus_webhook` on every write to every entity · `search()` re-embedding up to 1000 rows inline · backup reading whole tables into one in-memory document.

**Baseline:** 660/706 green / 0 red / 46 skipped on `worktree-durability`.

**The sentence this chunk is accountable to:** *no single caller, subscriber, or table can make the instance spend memory or time it does not have.*

Chunks 1 and 2 fixed things that were **wrong**. This one fixes things that are **unbounded** — correct at the scale they were written for and not at any other. The distinction matters for how the fixes are judged: a bound is only worth having if it is honest about what it does not cover, so every one below states its blast radius.

---

## 0. One stale item, removed rather than re-fixed

The audit listed **`dev.js`'s oversize body hangs the request** — `req.destroy()` past 256KB meaning `"end"` never fires, the promise never settles, no response written. That was already closed by the security chunk (`dev.js`'s `readJson` now resolves an `E_BODY_SIZE` sentinel and destroys the socket *after* the response, with the reasoning in a comment). STATUS still lists it as open in two places. It is removed from the list rather than counted as work here — reporting a fix for something already fixed would inflate this chunk by one.

---

## 1. Rate limiting — and the bound on the limiter itself

There is none. `/_auth/challenge`, `/_auth/verify` and every `/api/v1/*` route accept requests as fast as a client can open connections. The body-size and challenge-map caps from chunk 1 bound *memory per request*; nothing bounds *request rate*.

### Design

A zero-dep token bucket in `src/core/HTTP/ratelimit.js`, browser-irrelevant but kernel-clean (no Node imports — it takes a clock and returns decisions).

- **Two tiers, because the risk differs.** Pre-auth routes (`/_auth/challenge`, `/_auth/verify`) get a tighter bucket than authenticated API traffic: they are reachable by anyone and each one costs a signature verification. Authenticated traffic is attributable and can be generous.
- **Keyed by client IP**, taken from the socket. Not from `X-Forwarded-For` by default — trusting a header an attacker controls turns the limiter into a no-op, and turns it into an amplifier if someone keys a cache on it. A `trust_proxy` config opts in for deployments that genuinely sit behind one.
- **429 with `retry-after`**, and the same shape from both servers.
- **Configurable** through `config.limits`, with defaults chosen to be invisible to normal use.

### The part that is easy to get wrong

**The limiter's own map is unbounded.** A per-IP bucket map with no cap has precisely the bug I3 found in the challenge map — an attacker with many source addresses grows it without limit, so the anti-DoS measure becomes the DoS. The map is swept of idle buckets and hard-capped; at the cap, new keys are refused a bucket and fall back to the *tightest* tier rather than to unlimited. Failing closed is the only safe direction here, and it gets its own clause.

### Blast radius, stated

The bucket is per **process**, in memory. Two processes behind a load balancer allow twice the configured rate, and a restart forgets everything. This is a real bound against a single noisy client and it is not a defence against a distributed flood; that belongs at the proxy or the network. Written into STATUS, not implied.

---

## 2. SSE fan-out: dedupe before parallelism, and a subscriber cap

`emit()` awaits `visible()` per subscriber, in sequence, and each `visible()` for a create/update is a full `plane.get`. A thousand idle-but-connected subscribers make every single write cost a thousand serial queries.

The obvious fix is to parallelise. That is the wrong first move: it converts a thousand serial queries into a thousand concurrent ones, which is harder on the engine, not easier.

### The actual shape of the waste

Subscribers do not have a thousand distinct authorization contexts. They have a handful — most share a role, and therefore share a policy set. The question `visible()` asks is a pure function of *(entity, id, event, policy set)*, and the answer is identical for every subscriber holding the same policies.

**So: memoise per emit, keyed by a fingerprint of the subscriber's authorization inputs** (user, roles, policies, shares). One thousand subscribers across five distinct contexts becomes five queries instead of a thousand. The cache lives for exactly one `emit()` call and is discarded — no staleness window, no invalidation problem.

The fingerprint must include `user`, because `$CURRENT_USER` and `ifOwner` make the same policy set mean different things for different users. Getting that wrong would show one tenant another's row. It gets its own clause, asserting that two subscribers with identical policies but different users are *not* deduped together.

Bounded parallelism over the remaining distinct contexts is then a small, safe addition on top.

### Subscriber cap

`maxSubscribers` (default generous), refused with 503 and a clear message. An open SSE connection is a held socket plus a per-write cost; unbounded is not a position.

---

## 3. `fire()` stops full-scanning `nexus_webhook`

Every write to every entity does `plane.list("nexus_webhook", {}, ctx)` — a full scan to discover subscriptions, on the hot path of every create, update and delete in the instance.

### Design

Cache the webhook rows and refresh them through the **same hook mechanism** the server already uses for `nexus_policy` and `nexus_user` (`refreshPolicies`/`refreshUsers` in `server.js`). This is reuse, not new machinery: the pattern, its invalidation events, and its "a Studio write is instantly live, no restart" property are all already there and already proven.

Malformed `events` JSON keeps its current behaviour — warn once and skip that row — but moves to refresh time, so a broken row is reported once when written rather than on every subsequent write forever.

---

## 4. `search()` caps its inline re-embedding, and finishes the job in the background

`#currentVectors` re-embeds every candidate whose stored vector is missing or belongs to a different model, inline, in the request. After a model switch that is up to `MAX_LIMIT` (1000) rows of synchronous ML work inside one HTTP request.

### Design

Cap the inline work at `config.semantic.max_inline_embed` (default 64), and **enqueue the remainder as a job** through the effect engine that already exists. The request ranks with the vectors it has; the next search over the same corpus is complete.

The alternative — silently ranking against a partially-embedded corpus with no path to completion — would be worse than the unbounded version, because it degrades quietly and forever. Finishing in the background is what makes the cap honest, and it is why this uses the job queue rather than just truncating.

Where no queue is bound (the plane can be used standalone), the cap still applies and the shortfall is reported through the same `onHookError`-style sink rather than being invisible.

---

## 5. Backup streams instead of inhaling

`nexus site backup` does `SELECT *` per entity into memory, assembles one JSON document, and `JSON.stringify(…, null, 2)`s it. Chunk 1 made it *complete* (system entities included), which made this strictly worse — it now inhales more tables than before.

### Design

Write the document incrementally to a file stream, reading each entity in pages ordered by `id`:

```
open stream → write header (backupVersion, createdAt, config, apps)
  → per entity: page through rows (LIMIT n OFFSET …), writing each page as it arrives
    → write migrations, close
```

Peak memory becomes one page (default 500 rows) rather than the whole database. **The output format does not change** — same `backupVersion`, same shape, byte-comparable for a small instance. That is a hard requirement: the round-trip contract (`ARCHITECTURE.md:501`) is a public promise, and a streaming writer that produced a different document would break restore for every existing backup.

### The half this does not fix, stated plainly

**`restore` still parses the whole document.** The failure the audit named — backup OOMing on a real dataset — is on the write side, and that is what this closes. A restore of a multi-gigabyte backup will still exhaust memory. Fixing that needs an incremental JSON reader, which is a genuinely larger piece of work and is not smuggled in here. It goes to Unfinished with its own entry, because a half-fixed round trip that nobody wrote down is exactly the drift these chunks exist to prevent.

---

## 6. What this chunk is NOT

- **Not** a defence against distributed floods (§1's blast radius).
- **Not** streaming restore (§5).
- **Not** the in-process HTTP coverage clauses for `server.js`/`api.js`/`start.js` — that is the remaining #9 chunk after this one.
- **Not** connection-level limits below HTTP (socket counts, slowloris). Those belong to the proxy or a future server-hardening pass; claiming them here would overstate what a token bucket does.

## 7. Error handling

New refusals are typed and loud: `429` with `retry-after` for rate limits, `503` for the subscriber cap. The rate-limiter's own cap fails **closed** (tightest tier), never open. No new silent path: the search cap reports its shortfall, and the webhook cache reports malformed rows at refresh time instead of on every write.

## 8. Testing

Every clause RED first.

| Area | Clause | Asserts |
|---|---|---|
| §1 | `RATE-01` | a bucket allows its burst then refuses with 429 + `retry-after`; refills over time on an injected clock |
| §1 | `RATE-02` | pre-auth routes are limited more tightly than authenticated ones |
| §1 | `RATE-03` | the limiter's own key map is swept and capped — a flood of distinct IPs cannot grow it without bound |
| §1 | `RATE-04` | at the cap, an unknown key falls back to the TIGHTEST tier, never to unlimited (fails closed) |
| §1 | `RATE-05` | `X-Forwarded-For` is ignored unless `trust_proxy` is set — a header the caller controls cannot buy a fresh bucket |
| §2 | `EVT-FANOUT-01` | N subscribers sharing one policy set cost ONE visibility query, not N |
| §2 | `EVT-FANOUT-02` | two subscribers with identical policies but DIFFERENT users are never deduped together (`ifOwner`/`$CURRENT_USER` make the same policies mean different things) |
| §2 | `EVT-FANOUT-03` | the memo lives for one emit only — a row's visibility changing between emits is seen |
| §2 | `EVT-CAP-01` | subscribing past `maxSubscribers` is refused with 503, and existing subscribers are unaffected |
| §3 | `WH-CACHE-01` | a write to an unrelated entity issues NO `nexus_webhook` query |
| §3 | `WH-CACHE-02` | creating/updating/deleting a webhook row refreshes the cache immediately — no restart |
| §4 | `SEM-CAP-01` | inline re-embedding stops at the configured cap |
| §4 | `SEM-CAP-02` | the remainder is enqueued, so the corpus completes rather than degrading forever |
| §5 | `SITE-STREAM-01` | the streamed document is byte-identical to the shape restore already accepts |
| §5 | `SITE-STREAM-02` | rows are read in pages — a large table never lands in memory whole (driven by counting the LIMITs issued) |

## 9. Out of scope, recorded

Streaming restore (§5). In-process HTTP coverage clauses — the last #9 chunk. Issue #8 (install/update/uninstall lifecycle) remains decisions-first and untouched.
