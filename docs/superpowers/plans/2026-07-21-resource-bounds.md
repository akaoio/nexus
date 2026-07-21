# Resource Bounds Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** no single caller, subscriber, or table can make the instance spend memory or time it does not have. Closes the last of issue #9 — rate limiting, subscriber cap, SSE fan-out cost, `fire()`'s full scan, `search()`'s inline re-embed cap, backup memory.

**Architecture:** one new kernel-clean primitive (a token bucket), one memoisation inside the existing event hub, and three reuses of patterns already in the tree (the server's refresh-cache for webhooks, the effect queue for deferred embedding, paged reads for backup).

**Tech Stack:** Node ESM zero-dep kernel; the repo's own runner (`node test.js`).

**Spec:** `docs/superpowers/specs/2026-07-21-resource-bounds-design.md` · **Issue:** #9

## Global Constraints

- Spec-first TDD: every clause RED before its fix. **Baseline: 660/706 green / 0 red / 46 skipped** on `worktree-durability`. End state 0 red, skips not increased.
- No new runtime dependency (N2). The backup document format does NOT change — the round-trip contract is a public promise (`ARCHITECTURE.md:501`).
- Every bound states its blast radius in STATUS. A bound that overstates itself is worse than none.
- Commit style: repo sentence style, one concern per commit; every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: Remove the stale `dev.js` oversize-body item from STATUS

**Files:** Modify `STATUS.md`

- [ ] **Step 1** — the security chunk already fixed it (`readJson` resolves an `E_BODY_SIZE` sentinel; the socket is destroyed after the response). Drop it from both places it is listed rather than counting it as work here.

---

### Task 2: A token bucket, and a bound on the bucket map itself

**Files:** Create `src/core/HTTP/ratelimit.js` · Test `test/http/ratelimit.test.js` (create; register in `test.js`)

**Interfaces produced:** `createLimiter({ tiers, maxKeys, now })` → `{ check(key, tier) → {allowed, retryAfter}, size() }`

- [ ] **Step 1: Clause (RED)** — `RATE-01`: a bucket allows its burst, then refuses with a `retryAfter`, and refills over time on an injected clock.
- [ ] **Step 2: Clause (RED)** — `RATE-03`: idle buckets are swept and the key map is hard-capped — a flood of distinct keys cannot grow it without bound. This is I3's bug one level up: an unbounded anti-DoS map IS the DoS.
- [ ] **Step 3: Clause (RED)** — `RATE-04`: at the cap, an unknown key falls back to the TIGHTEST tier, never to unlimited. Fails closed.
- [ ] **Step 4: Implement** — pure, no Node imports, injected clock.
- [ ] **Step 5: Verify** — `node test.js`.

---

### Task 3: Both servers apply it, pre-auth more tightly than authenticated

**Files:** Modify `src/cli/commands/start.js`, `src/cli/commands/dev.js` · Test extend `test/http/ratelimit.test.js`

- [ ] **Step 1: Clause (RED)** — `RATE-02`: `/_auth/challenge` and `/_auth/verify` are limited more tightly than `/api/v1/*`; both answer 429 with `retry-after`.
- [ ] **Step 2: Clause (RED)** — `RATE-05`: `X-Forwarded-For` is ignored unless `config.limits.trust_proxy` is set — a header the caller controls must not buy a fresh bucket.
- [ ] **Step 3: Implement** — key from the socket address; `config.limits` with invisible-to-normal-use defaults.
- [ ] **Step 4: Verify** — `node test.js`; every `START-*`, `API-*`, `AUTH-*` clause still green (they issue many requests in a run — if the defaults are too tight this is where it shows).

---

### Task 4: SSE fan-out — memoise per emit, and cap subscribers

**Files:** Modify `src/core/HTTP/events.js` · Test `test/http/event-fanout.test.js` (create; register in `test.js`)

- [ ] **Step 1: Clause (RED)** — `EVT-FANOUT-01`: N subscribers sharing one policy set cost ONE visibility query, not N (count the `plane.get` calls).
- [ ] **Step 2: Clause (RED)** — `EVT-FANOUT-02`: two subscribers with identical policies but DIFFERENT users are never deduped together. `$CURRENT_USER`/`ifOwner` make the same policy set mean different things, so a fingerprint that omitted the user would show one tenant another's row.
- [ ] **Step 3: Clause (RED)** — `EVT-FANOUT-03`: the memo lives for exactly one `emit()` — a visibility change between emits is seen.
- [ ] **Step 4: Clause (RED)** — `EVT-CAP-01`: subscribing past `maxSubscribers` is refused with 503 and existing subscribers are unaffected.
- [ ] **Step 5: Implement** — fingerprint over `{user, roles, policies, shares}`; memo discarded at the end of each emit; bounded parallelism over the distinct contexts that remain.
- [ ] **Step 6: Verify** — `node test.js`; every `EVT-*`, `EVT-U*`, `EVT-ROWGATE-*` clause still green.

---

### Task 5: `fire()` reads a cache the existing hook mechanism refreshes

**Files:** Modify `src/core/App/effects.js` · Test `test/app/webhook-cache.test.js` (create; register in `test.js`)

- [ ] **Step 1: Clause (RED)** — `WH-CACHE-01`: a write to an entity with no webhooks issues NO `nexus_webhook` query.
- [ ] **Step 2: Clause (RED)** — `WH-CACHE-02`: creating, updating or deleting a webhook row refreshes the cache immediately — no restart, matching the property `refreshPolicies`/`refreshUsers` already guarantee.
- [ ] **Step 3: Implement** — reuse the `server.js` refresh-cache shape verbatim rather than inventing a second one; malformed `events` JSON is warned about at refresh time, so a broken row is reported once when written instead of on every write forever.
- [ ] **Step 4: Verify** — `node test.js`; every `WH-*`, `JOBL-*` clause still green.

---

### Task 6: `search()` caps inline embedding and finishes in the background

**Files:** Modify `src/core/Data.js` · Test `test/semantic/embed-cap.test.js` (create; register in `test.js`)

- [ ] **Step 1: Clause (RED)** — `SEM-CAP-01`: inline re-embedding stops at the configured cap (default 64), not at `MAX_LIMIT`.
- [ ] **Step 2: Clause (RED)** — `SEM-CAP-02`: the remainder is enqueued so the corpus completes. Without this the cap would degrade ranking quietly and forever, which is worse than the unbounded version.
- [ ] **Step 3: Implement** — `config.semantic.max_inline_embed`; enqueue through the effect queue when one is bound, report the shortfall through the plane's error sink when none is.
- [ ] **Step 4: Verify** — `node test.js`; every `SEM-*`, `VEC-*`, `GEM-*`, `REM-*` clause still green.

---

### Task 7: Backup streams, in pages, without changing the document

**Files:** Modify `src/cli/commands/site.js` · Test extend `test/cli/ops.test.js` or create `test/cli/backup-stream.test.js`

- [ ] **Step 1: Clause (RED)** — `SITE-STREAM-01`: the streamed document is the shape restore already accepts — same `backupVersion`, same keys, round-trips.
- [ ] **Step 2: Clause (RED)** — `SITE-STREAM-02`: rows are read in PAGES — assert on the LIMITs issued, so a large table never lands in memory whole.
- [ ] **Step 3: Implement** — write header → per entity, page by `id` → migrations → close. Format unchanged; peak memory becomes one page.
- [ ] **Step 4: Verify** — `node test.js`; `SITE-BACKUP` and the round-trip clauses still green; a real `nexus site backup` + `restore` by hand.

---

### Task 8: Tell the truth in the docs

**Files:** Modify `STATUS.md`

- [ ] **Step 1** — move the closed items into a **Resource bounds** row with their clause ids; refresh the headline count.
- [ ] **Step 2** — record each bound's blast radius: the rate limiter is per-process and per-IP, so N processes allow N× the rate and a distributed flood is not covered; the subscriber cap bounds sockets, not bandwidth.
- [ ] **Step 3** — record the half §5 does NOT fix: `restore` still parses the whole document, so a multi-gigabyte backup still exhausts memory on the way back in. Own entry, because a half-fixed round trip nobody wrote down is exactly the drift these chunks exist to prevent.
- [ ] **Step 4** — state that issue #9 is now fully closed except the in-process HTTP coverage clauses.
- [ ] **Step 5: Verify** — full `node test.js`; record the final count.

---

## Definition of done

- 0 red. Green ≥ 660 + the new clauses. Skips not increased.
- `nexus site backup` + `restore` round-trip exercised by hand.
- A `nexus dev` session survives ordinary Studio use without tripping the rate limiter — if the defaults are visible in normal use they are wrong.
- STATUS carries no bound that claims more than it delivers.
