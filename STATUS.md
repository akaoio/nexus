# Nexus — Status

Spec-first (conformance clauses written RED before code, N6). Every claim below
is backed by a passing clause on real infrastructure — no stubs, no fakes.

**Green: 692/738 node clauses, 0 red.**
(46 node "skips" are browser-only clauses plus the gated real-model suites —
EmbeddingGemma/FunctionGemma run where `test/.engines` has the library.)

**Issue #9 is closed except for one deferred chunk.** A skeptical audit (issue
#9) found 5 Critical and 11 Important findings, none covered by any clause at
the time. Three chunks have landed since:

1. **Security hardening** — all 5 Criticals and the security-class Importants
   (I1–I5, I10). See the **Security hardening** row below.
2. **Harness integrity** — the three ways the runner could report success while
   asserting nothing. See the **Harness integrity** row.
3. **Durability & atomicity** — I6, I7, I8, I9, I11 plus the TOCTOU and
   WAL/`busy_timeout` moderates. See the **Durability & atomicity** row.

4. **Resource bounds** — rate limiting, the subscriber cap, SSE fan-out cost,
   `fire()`'s full scan per write, `search()`'s inline re-embed cap, backup
   memory. See the **Resource bounds** row below.

5. **In-process HTTP coverage** — the auth seam and the transport contract are
   now driven directly, not only observed through spawned subprocesses. See the
   **HTTP coverage** row below.

**Issue #9 is closed.** Every Critical, every Important and every moderate it
raised has landed, and each bound carries its blast radius under Unfinished
rather than implying more than it delivers. The one item from its coverage map
still owed is `update.js`/`uninstall.js`, which cannot be pinned before issue #8
decides what that lifecycle IS — writing clauses against undecided behaviour
would freeze it by accident.

**Two findings in this work were NOT in the audit**, and both are recorded
because the way they hid is more instructive than the bugs themselves — see
"What the durability chunk found that nobody had looked for" below.

## Implemented & proven

| Area | What's real | Clauses |
|---|---|---|
| Query AST | 4-target compiler; golden invariant (compiled SQL ≡ reference predicate) | AST-*, CMP-* |
| Model Schema + Migration | frozen format; hot/structural apply, dry-run, ledger, rename | MS-*, MIG-*, DDL-* |
| Permission | deny-by-default; row rules as AST injected into every query; permlevel; ifOwner | PERM-* |
| Data Plane | CRUD, list, search behind one executor contract | DPL-*, ADP-* |
| **Engines (live, in-process)** | sqlite (built-in) · **Turso** · **Postgres via PGlite** — golden invariant holds on each | LIVE-turso-*, **LIVEPG-*** |
| Sync core | HLC total order; signed content-addressed events; 4 gates + quarantine; row refold ⇒ confluence | SYNC-E/O/F/Q/V/M |
| **Sync transport** | **real ZEN mesh** — two peers converge over WebSocket gossip; idempotent; tamper-rejected | **ZSYNC-*** |
| **Sync checkpoint (§8/§9)** | **arbiter-signed checkpoints; Merkle state root; prune-on-match; snapshot bootstrap; late-event handling** | **SYNC-C-*** |
| **Sync gate 3 (§3/§5)** | **permission → real ZEN PEN bytecode, evaluated by ZEN's policy VM (pen.wasm)** | **SYNC-P3-*** |
| Semantic | schema serialization; **real EmbeddingGemma-300m (default) + all-MiniLM**; sqlite-vec ANN; RRF; **model PROFILES registry (prompts/floor/threshold per family — App/models.js)** | SEM-*, REM-*, **GEM-***, VEC-* |
| NL → AST | rule + embedding-retrieval + **FunctionGemma-270M tier: schema as a TOOLS declaration through the chat template (Google dialect: string types + nullable), strict call parser**; validated against schema (injection-safe); **NL model is first-class on every surface (create wizard defaults to FunctionGemma + `--nl-model`, two-slot `nexus model`, `/_studio/ai`, Studio /settings/ai)** | NL-*, **FG-***, **MODEL-07..09** |
| **System entities** | **nexus_user/role/policy/view are ordinary Model Schema v1 docs on the SAME pipeline; shipped baselines (admin bundle per loaded entity, self-service via $CURRENT_USER rule); bootstrap import; directory-backed auth**; **permissions editor edits nexus_policy ROWS through the plane — layered read window `GET /api/v1/_policy-layers`, additive-union contract pinned, bespoke POST dead** | **PERM-U01, SYS-06..08, STUDIO-04/06/07, POLWIN-*** |
| **Entity lifecycle** | **/entities directory (list view), cascade DELETE behind a pure dry-run plan + typed confirm; hot reload — entity CRUD never restarts dev; field `span` (form grid) + `views` opt-in in Model Schema v1** | **LIFE-*, MS-S12/13** |
| **Roles** | **role = named policy bundle; rolesIn() overview; /roles + multi-role /users pages over plain entity rows** | **ROLE-*** |
| **Saved views (§7)** | **persisted through the Data Plane (permissioned, ownable); applyView reconstructs the list** | **VIEW-*** |
| AuthN | API keys; challenge-sign; HMAC tokens; role mapping; **WebAuthn PRF → deterministic ZEN identity** | AUTH-*, **AUTH-PRF-*** |
| Kernel / CLI / Studio | extracted from akao; real-process CLI; full tabbed Studio (Data+Ask/Form/Search/Schema/Permissions) in `nexus dev` | KRN-*, CLI-*, NX*-* |
| HTTP + serving | auto API (`/query`, `/search`, `/ask`); `/_health`; request logging | API-* |
| **Production server** | **`nexus start` — refuses god-mode (E_NO_AUTH), TLS-required (E_NO_TLS/--insecure), auth-enforced, no Studio/framework exposure, self-served HTTPS** | **START-*** |
| **Studio in production (issue #10)** | **the Studio's whole data plane now runs under `nexus start`: shipped as static assets (`nexus studio build` → `public/studio/`, served through the existing static boundary — zero new server surface); login is the ZEN challenge/verify handshake (`POST /api/v1/_auth/challenge` + `POST /api/v1/_auth/verify`), whoami is `GET /api/v1/_session` (read-only, no POST); the read-only policy baseline layers via `GET /api/v1/_policy-layers`; data, users, roles, permissions, jobs, search, and settings (locales/themes) all work end to end; nav is derived from the boot `mode`, so a production build's sidebar never offers a page it can't serve. Schema editing (`/_studio/model`, entity-delete) and config writing (`/_studio/config`, `/_studio/ai`) stay dev-only — see Unfinished** | **STUDIO-13, START-SESSION, STUDIO-09b, POLWIN-03, POLWIN-04, VND-07, STB-01, STB-02, STB-03, STB-03a, STB-03b, STB-04, START-STUDIO, START-STUDIO-ABSENT, PROD-01, PROD-02, PROD-03, ROUTES-*** |
| Security | pentest findings pinned as clauses (info-disclosure, oracle, static-serve) | SEC-* |
| **Install/lifecycle** | **one-line installers (install.sh / install.ps1, GitHub-first, tarball fallback, npm never required); `nexus update` (git fetch+hard-reset, the access pattern) and `nexus uninstall --yes`** | CLI-* (help pin) |
| **Entity identity** | **schema `icon:` (any bootstrap-icons name — vendored 1.1 MB sprite, nx-icon registry-first with sprite fallback); picker in the /entities editor** | MS-S14 |
| **Effect engine** | **durable jobs as `nexus_job` rows (token-CAS claim, backoff, DLQ, recurring), Threads execution behind the narrow plane-RPC, webhook/mail/notification consumers as the effect app, Studio /jobs** | SYS-09, JOB-*, EXT-J1, THR-*, JOBL-*, WH-*, MAIL-*, NOTIF-* |
| **Realtime** | **public SSE `/api/v1/_events` (auth'd incl. `?token=`, per-subscriber plane-gated, no row data on the wire, heartbeat); Studio live refresh on every list route via the public stream; dev `/__dev_events` + watcher + full module hot-swap + `"reload"` on schema hot-apply** | **EVT-U*, EVT-*, HMR-*, DEVE-*** |
| **HTTP coverage (issue #9 chunk 4)** | **the auth seam is exercised IN PROCESS, not only through spawned subprocesses: `createApi` returns a plain `handle(req, res)`, so routing → the `?token=` fold → `context()` → policy composition → the plane → the status mapping is drivable with a fake req/res, with no production change needed to make it testable. Pinned there: the dev identity branch production must never reach (the other half of START-01), deny-by-default for an authenticated caller with no roles, a token's `roles` claim being IGNORED in favour of the live directory (I4's mechanism, in one call rather than a whole instance), an unprovisioned pub carrying nothing (C1b's other half), `?token=` authenticating the event stream ONLY so a query-string token can never read data, and the enforced policy set and the read-only window deriving from ONE `policyLayers()` call so they cannot drift** | **HTTPX-A01..A05, HTTPX-R01..R04, HTTPX-P01** |
| **Resource bounds (issue #9 chunk 3)** | **nothing unbounded by a single caller: a zero-dep token bucket limits both servers, with the pre-auth tier strictly tighter (anyone can reach it and each call costs a signature check), a separate bucket per (tier, key) so ordinary API traffic cannot drain the pre-auth allowance, `X-Forwarded-For` ignored unless `trust_proxy` is declared, `/_health` exempt so a flood cannot take the instance out of rotation, and — the two that matter most — the limiter's OWN key map swept and hard-capped, failing CLOSED to the tightest tier when full rather than waving strangers through; SSE fan-out memoised per emit by authorization fingerprint (INCLUDING the user, since `$CURRENT_USER`/`ifOwner` make identical policies mean different things), so N subscribers across k contexts cost k reads not N, plus a subscriber cap; webhook dispatch reads a cache refreshed through the same after-hook mechanism `nexus_policy`/`nexus_user` already use, so twenty writes cost one read instead of twenty and a Studio write is still instantly live; `search()` embeds at most a configured cap inside a request and drains the rest in the background, so a model switch cannot put 1000 rows of ML work in one HTTP response and the corpus still completes; `nexus site backup` streams in pages of 500 and its summary now reports what it ACTUALLY captured, naming what it skipped** | **RATE-01..09, EVT-FANOUT-01..03, EVT-CAP-01, WH-CACHE-01..03, SEM-CAP-01..03, SITE-STREAM-01/02, SITE-COUNT-01** |
| **Durability & atomicity (issue #9 chunk 2)** | **the executor has a REAL transaction seam — one connection for the whole callback, so a pooled driver can no longer scatter `BEGIN`/body/`COMMIT` across three connections (the pre-seam improvisation did, silently); `BEGIN IMMEDIATE` on sqlite/turso, capability-declared (`CAPABILITIES.transactions`, kept separate from `transactionalDDL`), no nesting (`E_NESTED_TX`), and a failed rollback never replaces the error that caused it. On top of it: a write and everything derived from it commit together, with the embedding derived BEFORE the transaction so a failed model leaves no row and inference never holds a write lock; an `after:` hook that throws no longer fails a durable write and is contained through `onHookError`; `update`/`remove` carry the permission predicate on the write STATEMENT and confirm it matched, closing the TOCTOU window; entity delete moved into core as one transaction that swallows nothing (and now actually drops the link column — see the findings section); `hotApply` runs inside a transaction where DDL can roll back and reports `atomic: false` where it cannot; `after:remove` carries the captured pre-image so a deleted row's id no longer crosses the row rule that protected it — the row DECIDES and is never SENT; a timed-out job reclaims its queue entry AND recycles the worker, and the execution timeout is derived from the lease so the two cannot be equal again; file-backed sqlite runs in WAL with a busy timeout, surfaced by `nexus doctor`** | **TXN-01..05, ADP-TXN, ADP-WAL-*, DPL-ATOMIC-*, DPL-TOCTOU-*, LIFE-TX-*, MIG-HOTTX-*, EVT-ROWGATE-*, THR-CANCEL-*, JOB-TIMEOUT-*** |
| **Harness integrity (issue #9 follow-up)** | **a run that verifies nothing is not green — zero passes fails the run and prints why, through one exported rule (`isGreen`) both the summary and the exit code read; the Sync stub stands in only for an *absent* `src/core/Sync.js`, so a present-but-broken module surfaces its own import error instead of answering `NOT_IMPLEMENTED`; a ZSYNC harness that produced no verdict is an explicit skip carrying its spawn error as a warning, not a `{ browser: true }` no-op with the error buried in the test name** | **RUN-01, SYNCLOAD-01, ZSYNC-00** |
| **Security hardening (issue #9 Criticals + security Importants)** | **`nexus_user.roles` behind `permlevel:1` with an admin permlevel-1 companion policy, so self-service cannot promote itself, pinned by driving the actual escalation through the plane (SYS-11 also asserts the field IS restricted, so the invariant loop cannot silently skip it on a revert); `/_auth/verify` refuses an unprovisioned pub — holding a keypair is not membership; create/update return through the actor's READ-scoped field set, not the write set; backup carries the system entities (users/roles/policies/views/webhooks/notifications), redacts config secrets AND declared row-level secret columns (webhook `secret`, job `lease_token`), and fails loudly (not silently) on an app-schema read error; `/_studio/*` — including `/_studio/session`'s own whoami body, the last surface that used to trust token claims — authorizes from ONE declared per-route table (`dev-access.js`) with an admin-only default, "any" meaning no-auth-at-all rather than a role tier, and roles resolved from the live directory everywhere, never the token; engine capabilities are declared (`CAPABILITIES`/`capabilitiesFor`, fail-closed for unknown engines) and a non-transactional-DDL dialect refuses the structural path — dry-run included — before any statement runs; roles resolve per REQUEST from the live directory for token-bearing callers, so revoking/deleting a user's row takes effect on their very next call without re-issuing the token (this does NOT cover API keys, whose roles come from `config.api_keys[].roles` and are operator-managed rather than directory-revocable, nor an already-open SSE subscription, which captures its ctx once at connect); `/_studio/users` add/role-set writes the `nexus_user` directory row (not just `nexus.config.json`), so a Studio-provisioned identity can actually complete the ZEN handshake past first boot, instead of reporting `applied: true` for an identity that cannot log in; webhooks are http(s)-only at write and dispatch time, timeout-bounded, non-redirecting, and the signing secret never enters the job ledger; both servers cap pre-auth request bodies, the challenge map is swept and capped under a flood, and production refuses to boot without a real `token_secret`** | **SYS-10/11/12/13, AUTH-STRANGER, DPL-PERMLEVEL, DPL-ASYMMETRIC, SITE-BACKUP, OPS-10, STUDIO-08/09/09a/10/11/12, ADP-CAP, MIG-NOTX, AUTH-REVOKE, AUTH-REVOKE-DELETE, WH-04/05/06/07, START-BODY/CHALLENGE/SECRET** |

## What writing the clauses found that nobody had looked for

Four defects surfaced while writing clauses across chunks 2–4, none of them in
the audit. All are fixed; all are recorded because how they stayed hidden is the
transferable part.

**1. The API layer answered 400 where its own contract said 413.** `api.js`'s
header has always documented "413 oversized body", and both servers answer 413
for the same condition at their pre-auth readers — but `E_BODY_SIZE` was missing
from the status map, so the API route alone fell through to the 400 default. A
client written against the documented contract mishandled it. Found by the first
in-process clause that ever asserted the mapping (HTTPX-R02); no subprocess test
had ever sent an oversized body to an entity route.

**2. The structural migration's transaction was a no-op on a pooled Postgres.**
The engine had no transaction primitive: `applyMigration` improvised by sending
literal `BEGIN`/`COMMIT`/`ROLLBACK` strings through `run()`. That is correct on
ONE handle (node:sqlite, PGlite) and unsound on a POOL — `pg` and `mysql2` hand
out an arbitrary idle client per query, so the `BEGIN` opened a transaction
nobody committed, the DDL ran outside any transaction, and the `ROLLBACK` rolled
back nothing. The documented guarantee — "executes everything inside one
transaction, then rolls back" — was therefore **false on a live pooled Postgres**,
for a different reason than C5 made it false on MySQL. It stayed invisible
because the live-Postgres clauses run against PGlite, which is single-connection:
the engine where the guarantee breaks is the one the suite never exercises.
Closed by the transaction seam (`src/core/Data/transaction.js`, TXN-\*), and
TXN-02 pins it with a fake pool **deliberately** — a live-only test would have
kept it invisible for the same reason.

**3. Deleting an entity silently failed to drop link columns — every time.**
sqlite refuses to drop a column an index still references, and the DDL compiler
creates `idx_<entity>_<field>` for every link field. The cascade's
`ALTER TABLE … DROP COLUMN` therefore failed on **every** delete that had a link
pointing at the target — inside a `try {} catch {}`, after the schema file had
already been rewritten to say the field was gone. So the file said one thing and
the table said another, permanently, and the endpoint returned `{ok: true}`.
This was verified by hand against the real dev server before and after the fix,
not inferred. The audit flagged the swallowed catch as a *risk*; it was in fact
the normal outcome. `entityDeletePlan` now names the index (the plan is the dry
run an operator approves, and it was describing work that could not be
performed), and `applyEntityDelete` drops it first (LIFE-TX-\*).

**4. `nexus site backup` reported eight entities and wrote one.** On a fresh
instance the system tables do not exist yet — they are created when a server
first boots — so `isMissingTableError` correctly skipped them. But the summary
counted every schema it *intended* to back up. C3 made backup complete; it did
not make the report honest, and a backup that overstates itself is discovered at
the worst possible moment. The count is now what the file actually holds, and
anything left out is NAMED (SITE-COUNT-01).

**What the four share.** Every one is a guarantee stated in a comment or a
header, and exercised only on the engine, the path, or the route where it
happened to hold. None was found by reading the code with suspicion — the audit
did that thoroughly and missed all four. Each was found by writing a clause that
asserted the stated guarantee somewhere it had never been asserted before. That
is the argument for spec-first stated more precisely than "tests are good": a
clause is worth writing exactly where a claim has never been checked, and the
places nobody thought to check are where these live.

## Unfinished / known drift (honest list, 2026-07-21)

- **Issue #9 is closed; `update.js`/`uninstall.js` coverage is owed to #8.**
  C1–C5 and I1–I5/I10 closed with the security chunk; I6–I9 and I11 with the
  durability chunk, along with TOCTOU and WAL/`busy_timeout`; the moderates with
  resource bounds; the auth-seam coverage gap with the HTTP-coverage chunk. The
  coverage map's remaining entry — self-update does `git fetch` + hard reset and
  is entirely unexercised — stays open on purpose: clauses written against a
  lifecycle issue #8 has not specified would freeze it by accident. The bullets
  below record what each landed bound does NOT cover.
- **A behaviour change, declared (N3): an `after:` hook that throws no longer
  fails the write.** It runs once the write is durable, so propagating it told
  the caller to retry a write that had already happened — which produces a
  duplicate. The failure is now CONTAINED, not swallowed: it goes to the
  plane's `onHookError` sink (default and server wiring both log entity, event
  and error). An app that needs to veto a write has `before:`, which is what it
  is for; the migration is one word. Pinned by DPL-ATOMIC-02/03/04.
- **The pooled-transaction hazard is closed for the framework, not for every
  caller.** `createExecutor` now supplies a real `transaction()` and all
  framework write paths use it. A caller holding a plain executor can still
  hand-roll `run("BEGIN")` and get the old unsound behaviour on a pooled
  engine, and `transactionOf`'s compatibility fallback (which keeps executors
  that predate the contract working) gives neither the up-front write lock nor
  any guarantee if what it wraps is secretly a pool. Both are documented at the
  point of use in `src/core/Data/transaction.js` rather than left implicit.
- **`hotApply` is non-atomic on MySQL, by declaration.** MySQL commits DDL
  implicitly, so there is no envelope to be had; the work is still done and
  `atomic: false` is returned rather than the guarantee being implied. This is
  deliberately the opposite of the entity-delete cascade, which refuses
  outright on the same engines — a cascade is destructive, so a half-done one
  loses data, whereas a hot apply is additive by construction and refusing
  would mean a MySQL instance could not add a field at all (MIG-HOTTX-02).
- **Studio schema editing in production is still closed, and I8 was only half
  the reason.** Entity delete is now transactional and clause-covered, so that
  half is done; the hot-reload-under-load half is untouched, so the decision
  below stands unchanged.
- **The update path's embedding can be one write stale.** `update()` reads its
  pre-image and derives the embedding outside the write transaction, so model
  inference never holds a write lock. The authoritative permission gate is the
  injected WHERE on the UPDATE itself, so this is not an access-control gap —
  but a concurrent write to a field the permission rule does not mention can
  make the derived embedding reflect a slightly stale row. The next write of
  that row re-derives it.
- **The rate limiter's blast radius**: the token bucket is per PROCESS and per
  key, in memory. Two processes behind a load balancer allow twice the
  configured rate, and a restart forgets every bucket. It is a real bound
  against one noisy client and it is NOT a defence against a distributed
  flood — that belongs at the proxy or the network. `X-Forwarded-For` is
  ignored unless `limits.trust_proxy` is set, because it is a header the
  caller controls; behind a proxy that does NOT set it, every request keys to
  the proxy's own address and the whole deployment shares one bucket. Turning
  the limiter off (`limits.enabled: false`) is supported and sometimes right.
- **Backup streams; RESTORE still does not.** Backup now writes to a stream in
  pages of 500, so creating one is bounded by a page rather than the whole
  database. `restore` still `JSON.parse`s the entire document, so restoring a
  multi-gigabyte backup will still exhaust memory. The failure issue #9 named
  was on the write side and that is what closed; the read side needs an
  incremental JSON reader, which is a genuinely larger piece of work and was
  not smuggled in. Stated here rather than left as a half-fixed round trip
  nobody wrote down.
- **The SSE subscriber cap bounds sockets, not bandwidth**: `maxSubscribers`
  refuses new connections past the cap and the per-emit memo means N
  subscribers sharing an authorization context cost one visibility read rather
  than N. Neither bounds how much a single slow consumer can make the process
  buffer — there is still no backlog cap or slow-consumer eviction.
- **Embedding backfill is best-effort and in-process**: `search()` embeds at
  most `semantic.max_inline_embed` (default 64) documents inside a request and
  drains the rest in the background on the main process. A restart mid-drain
  loses the remainder until the next search over that corpus re-schedules it,
  and the work competes with request handling. It does NOT ride the job queue:
  the job thread's plane RPC is deliberately four ops and cannot write the
  embedding tables, and widening that seam would trade a performance bound for
  a security surface.
- **The harness-integrity chunk of the follow-up is done, and it moved one
  number**: the `Test.js` all-skipped-reports-green hazard is fixed (see the
  **Harness integrity** row). Two consequences worth stating plainly. First,
  a filtered run that happens to skip everything now *fails* — that is the
  intended reading ("nothing was verified"), but it is a behavior change for
  anyone who ran a narrow subset and read exit 0 as success. Second, the
  ZSYNC mesh suite still does not run on every machine: where the harness
  cannot spawn (it needs `child_process` plus real local sockets) its nine
  clauses skip, so the transport claims in the table above rest on the
  environments where it does run, not on every run of `node test.js`.
- **The honest SSRF scope on webhooks (I1's fix is a narrowing, not a
  boundary)**: rejecting non-`http(s)` schemes does NOT stop
  `http://169.254.169.254/` (cloud metadata) or `http://localhost:<port>`
  (internal services) — both are perfectly valid http(s) URLs. `allow_hosts`
  is opt-in and defaults to permissive (empty = no allowlist), and even when
  configured it matches on `parsed.hostname` as a **string**, never a
  resolved address — a hostname that is allowed today and resolves elsewhere
  tomorrow (DNS rebinding) sails straight through. See the comments in
  `src/core/App/effects.js` (`validateWebhookRow`) for the exact boundary.
- **The revocation edge: a sole admin cannot durably revoke itself.**
  AUTH-REVOKE-DELETE makes deleting a directory row revoke immediately in
  the normal case, but the fallback to the config seed is keyed on
  `usersByPub.size === 0` (read live) — so deleting the LAST remaining
  directory row empties the directory and **re-arms the config seed** on the
  very next request. This is deliberate anti-brick behavior (nobody can lock
  themselves out of a running instance by deleting their own only row), but
  it means revocation is durable for every case with ≥1 row left, not the
  degenerate "delete the last admin" case. See `src/core/HTTP/server.js`
  around `rolesForPub` for the pinned comment (AUTH-REVOKE-DELETE).
- **Effect engine at-least-once semantics**: the job/webhook/notification pipeline is
  at-least-once; exactly-once is documented as NOT a goal (spec note: multi-process
  deduplication is complex, rare in practice). Consumers must be idempotent.
- **SMTP provider path**: the mail provider contract is live and tested; `provider:` is
  exercised through the MAIL-01 clause; actual SMTP delivery is only contract-tested,
  never against a live SMTP server in CI (infrastructure boundary, as with MySQL).
- **Job/webhook sync exclusion**: exclusion rules are a pinned list in nexus_job/nexus_webhook;
  per-instance exclusion enforcement (avoid re-syncing a job already claimed by another server)
  lands with server-side sync wiring (future task, separate from the effect engine itself).
- **Cron syntax and multi-process workers**: cron *syntax* is deferred by spec; `every_ms`
  recurrence IS implemented and clause-pinned (JOB-05). Multi-process worker pools are
  the deferred part.
- **Job thread pool is fixed at one thread in v1**: the `jobs.threads` knob lands with
  the pool.
- **Wire-contract deviation, deliberate**: `x-nexus-delivery` carries the job id only
  (stable across retries — receivers dedup redeliveries on it); the spec sketched
  jobId+attempt.
- **/jobs page browser pass owed**: the /jobs Studio page CRUDs and views jobs; E2E flows
  (job enqueue → webhook fire → notification row) are proven on the real infrastructure
  (JOBL-01/WH-02/03/NOTIF-01), but browser-side navigation and form validation are NOT yet
  pinned in CI (joins the E2E debt alongside login/cascade/hot-reload/accent clauses).
- **`/_studio/users` endpoints are legacy, but no longer inert**: the /users page
  itself CRUDs `nexus_user` rows directly; the old config-identities endpoints
  remain in dev.js for CLI parity, and as of the final review's item 2 their
  `add`/`role` actions ALSO write the `nexus_user` directory row (through the
  same internal ctx the server's own directory actor uses), so an identity
  provisioned this way can actually log in past first boot. `remove` still
  touches only `nexus.config.json` — revocation is the directory's job
  (`/api/v1/nexus_user`, AUTH-REVOKE-DELETE), not this endpoint's. Deciding
  these endpoints' longer-term fate (keep as bootstrap tooling vs delete) is
  still open.
- **Studio schema editing and config writing stay dev-only in production, deliberately**
  (issue #10, `docs/superpowers/specs/2026-07-20-studio-in-production-design.md` §5):
  `/_studio/model` (schema create/edit/delete) and entity-delete need hot-reload-under-load
  and a transactional entity-delete first (issue #9's I8, still open above); `/_studio/config`
  and `/_studio/ai` write the same file that holds `token_secret`/`api_keys` and have no safe
  production shape yet. An operator changes structure through git + redeploy, not the
  production Studio.
- **Spec-to-code delta, deliberate**: the design spec (§3) called for deleting
  `/_studio/entities` outright; the implementation kept it dev-only instead, in
  `dev-access.js`'s table, because it feeds only the dev-only schema designer — deleting it
  bought nothing once that designer stayed dev-gated, and the invariant clause (STUDIO-13)
  still catches it if it were ever opened to production undeclared.
- **`nexus studio build` is a copy step, not a bundler**: it walks `app.js`'s import graph and
  copies the reachable files, rewriting `/_nexus/src/...` specifiers to relative paths — no
  minification, no combining. Deliberate (zero-dep kernel, ES modules), not a gap, but
  production Studio assets ship as individual, unminified files.
- **Spec-to-code delta, deliberate**: `nexus studio build` is on-demand only — it is NOT yet
  wired into `nexus create` or `nexus update`, though the design spec (§2.4) anticipated that
  wiring. It belongs with the deferred install/update lifecycle work (issue #8). A freshly
  created instance therefore has no production Studio until an operator runs
  `nexus studio build` by hand.
- **Honest security note**: the built shell is served PRE-authentication for Studio routes
  (the shell itself has to load before login can happen) and bakes `boot.schemas` into that
  shell — full schema documents: field names, types, permlevels. So an anonymous caller can
  now read the schema SHAPE of an instance (no rows, no secrets, no config) just by hitting a
  Studio route. That is a small new reconnaissance surface that did not exist when production
  served no Studio at all — stated plainly rather than left implicit.
- **PROD-02's "a declared production route is served" direction is latent**: the clause checks
  both directions over the real `STUDIO_ACCESS` table, but every `/_studio/*` entry in that
  table is still dev-only (the bullet above), so `PRODUCTION_ROUTES` is empty today and only
  the "dev-only route correctly 404s in production" half is actually exercised. It starts
  proving the positive half the day any `/_studio/*` route is declared `modes: [..., "production"]`.
- **The authenticated browser click-through is manual, not a clause**: logging into the built
  Studio, loading `/users` and `/permissions`, and confirming `/entities` is absent from nav
  and `/_nexus/*` 404s is verified by hand, joining the existing E2E debt (login/cascade/
  hot-reload/accent) below — the transport, the route set, and the authorization are what the
  clauses above pin.
- **Component discipline is not yet total** (the pre-Huy akao bar): sidebar entries are
  now `<nx-navlink>` and the shell composes components, but hand-built DOM remains in
  several routes (users list rows, roles cards, entities editor chrome, settings/general
  form) and in kit/fields.js editors. These should become components or route templates.
- **Studio auth gate is boot-time** (`studioAuthAtBoot`): flipping auth ON live protects
  the data API immediately, but `/_studio/*` write endpoints only start demanding a token
  after the next dev restart.
- **Hot reload leaks one sqlite handle per reload** (dev-only, documented in dev.js).
- **`nexus dev` has no graceful teardown** (pre-existing): the file watcher and dev-events
  subscribers die with the process rather than unsubscribing cleanly on Ctrl-C. Harmless for
  a dev-only surface; a real teardown path is owed if dev ever holds anything that must be flushed.
- **FunctionGemma zero-shot quality is weak** for the recursive filter grammar
  (Vietnamese asks often refuse; compound English often malforms — safely rejected by
  translate() and covered by the tier chain). Fine-tuning on the filter dialect is the
  intended path (spec notes it); `dtype` for the generator is also not pinned yet. Enabling it no longer requires hand-editing config (MODEL-07..09).
- **Realtime event replay is not implemented** (`Last-Event-ID` v2 is deferred): reconnecting
  clients refetch the full list rather than resuming from a checkpoint. The hub is in-memory
  fan-out only — nothing is stored; a client that misses events recovers by refetching, not replay.
- **CLOSED (I11) — the `after:remove` id leak.** This entry used to disclose that the remove
  check was document-level, so any subscriber with document-level read learned the id of ANY
  removed row of an entity regardless of row-level restrictions. It was closed the way this
  entry itself predicted: `remove()` captures the full pre-image and passes it on both remove
  payloads, and the hub evaluates the row rule against it. The row DECIDES visibility and is
  never SENT — the frame is still exactly `{entity,event,id,ts}`, pinned by EVT-ROWGATE-03,
  because a fix that closed an id leak by shipping the row would be worse than the leak. A
  remove arriving with no pre-image now DENIES rather than falling back to the old permissive
  answer (EVT-ROWGATE-04). The clause that used to hold the old behaviour in place, EVT-U2,
  was rewritten with a comment saying exactly what moved.
- **In-browser swap loop (CSS/template/module HMR) is verified by hand** in Chrome, not pinned
  in CI — the module hot-swap mechanism is proven on the real infrastructure (DEVE-02/03), but
  the browser-side application of those swaps (entry point reexecution, style reinjection) are
  joins to the E2E debt alongside login/cascade/hot-reload/accent clauses.
- **Studio router has NO unmount hook** (`src/studio/app.js:181`): subscriptions ride ONE shared
  EventSource and stale routes self-reap on their first event after a navigation rather than
  closing cleanly. A real teardown hook is the structural follow-up (architectural debt, documented).
- **App-file changes broadcast a full `reload`** (apps/ is not browser-served): only framework files
  (`/_nexus/src/{studio,core}`) hot-swap at the module level. Schema hot-apply triggers `"reload"` to
  ensure app logic sees the new schema before any user action.
- **Token is re-read from localStorage only on reconnect**: mid-session re-login updates the token,
  but the shared EventSource connection keeps the old token until it reconnects (by entity-union
  change, or, since the final review's fix, automatically when the browser closes the connection
  on a 401 — see `src/studio/kit/events.js`'s `onerror`).
- **Subscriber ctx is captured once at connect**: `api.js` calls `context(req)` a single time when
  the SSE connection opens, so a mid-session revocation or role change does not affect a live
  subscriber until it reconnects. Exposure is bounded to event metadata (`{entity,event,id,ts}`)
  only — never row data — and any refetch through the ordinary API re-authorizes from scratch.
- **App code in `apps/` is server-trusted, by design, and nothing previously said so**
  (issue #9 final review): `DataPlane` (`src/core/Data.js`) trusts `ctx.policies` verbatim —
  it is hand the caller supplies, not looked up — and an app's `hooks.js` endpoint handlers
  receive `{ plane, ctx }` directly (`src/core/App/extensions.js`'s
  `endpoint(method, path, async ({ plane, ctx }) => …)` contract). An app endpoint can
  therefore construct any `ctx` it likes — any user, any roles, any permlevel — and call
  the plane with it; there is no sandboxing between "an app's own code" and "the engine's
  internal policy". This is pre-existing and intentional (apps ARE server code, the same
  trust level as the framework itself, not a third-party plugin sandbox), but it was an
  implicit assumption nobody had written down.
- **nexus_entity is a read view only** (`/_studio/entities`) — item 9's "everything is
  an entity" holds for user/role/policy/view ROWS; entity META stays files by decision,
  but a plane-level `nexus_entity` read adapter (list through /api/v1) is not built.
- **`span` drag-resize** is select-driven (1/3–3/3 dropdown); dragging a field's edge to
  resize was sketched in the spec but not built. Field reorder DnD exists (grip handle);
  it has no automated test (manual/browser-verified only).
- **Search overlay lacks keyboard navigation** (arrows/enter to open a hit) and the
  legacy `/search` page duplicates the same component — fine, but the overlay should
  eventually own result actions (open record).
- **E2E flows verified by hand in Chrome, not pinned in CI**: login, entity delete
  cascade, hot reload, accent switching, sidebar levels. A browser-suite pass over these
  is owed (the harness exists — NX*-* browser clauses).
- **LF/CRLF warnings** on Windows commits are noisy (no .gitattributes yet).
- **Installers are untested on clean machines**: install.sh/install.ps1 follow the
  access pattern and `nexus update`/`uninstall` are exercised only on this dev box
  (git-install path). A fresh-VM pass (POSIX + Windows), and a decision on npm
  publishing (name "nexus" is generic), are owed.
- **bootstrap-icons sprite is vendored whole (~1.1 MB)** and fetched per icon page
  load; fine for the Studio, but a build step could subset it.

## The two honest boundaries (need real infra/hardware, not code)

1. **MySQL live matrix** — the mysql adapter is contract-pinned and runs the
   identical clauses in CI against a real MySQL server. There is no in-process
   WASM MySQL (unlike Turso/PGlite), so it cannot be proven on a dev box. This
   is an infrastructure boundary, not missing code.
2. **Physical WebAuthn PRF read** — the derivation (PRF secret → seed → keypair)
   is deterministic and proven hardware-free (AUTH-PRF-*). Obtaining the PRF
   output from a security key / platform authenticator is inherently
   interactive; the ceremony helpers (`registerCredential`, `loginIdentity`)
   are real WebAuthn calls, exercised with a real or CDP-virtual authenticator.

## Notes on ZEN gate 3 scope

PEN enforces the structural/entity-level subset (§6's ✅ rows): a well-formed
soul naming a known entity, via ZEN's real policy VM. Per-author row/field
rules over the JSON value remain gate 4 (the design states they cannot be
absolute in P2P). Auto-running the compiled policy inside ZEN's own write
pipeline for relays that never installed Nexus is a ZEN-core capability; Nexus
peers run the identical bytecode at ingest.
