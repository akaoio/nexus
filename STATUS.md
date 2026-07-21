# Nexus — Status

Spec-first (conformance clauses written RED before code, N6). Every claim below
is backed by a passing clause on real infrastructure — no stubs, no fakes.

**Green: 595/648 node clauses, 0 red.**
(53 node "skips" are browser-only clauses plus the gated real-model suites —
EmbeddingGemma/FunctionGemma run where `test/.engines` has the library.)

**Issue #9's Criticals are closed.** A skeptical audit (issue #9) found 5
Critical and 11 Important findings, none covered by any clause at the time.
The security-hardening spec (`docs/superpowers/specs/2026-07-20-security-hardening-design.md`)
closed all 5 Criticals and the security-class Importants (I1, I2, I3, I4, I5,
I10) — see the **Security hardening** row below. The remaining Importants are
correctness/robustness findings, not security holes reachable by an outside
actor; they are deliberately deferred to a follow-up spec and listed honestly
under Unfinished below, not silently dropped.

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
| **Harness integrity (issue #9 follow-up)** | **a run that verifies nothing is not green — zero passes fails the run and prints why, through one exported rule (`isGreen`) both the summary and the exit code read; the Sync stub stands in only for an *absent* `src/core/Sync.js`, so a present-but-broken module surfaces its own import error instead of answering `NOT_IMPLEMENTED`; a ZSYNC harness that produced no verdict is an explicit skip carrying its spawn error as a warning, not a `{ browser: true }` no-op with the error buried in the test name** | **RUN-01, SYNCLOAD-01, ZSYNC-00** |
| **Security hardening (issue #9 Criticals + security Importants)** | **`nexus_user.roles` behind `permlevel:1` with an admin permlevel-1 companion policy, so self-service cannot promote itself, pinned by driving the actual escalation through the plane (SYS-11 also asserts the field IS restricted, so the invariant loop cannot silently skip it on a revert); `/_auth/verify` refuses an unprovisioned pub — holding a keypair is not membership; create/update return through the actor's READ-scoped field set, not the write set; backup carries the system entities (users/roles/policies/views/webhooks/notifications), redacts config secrets AND declared row-level secret columns (webhook `secret`, job `lease_token`), and fails loudly (not silently) on an app-schema read error; `/_studio/*` — including `/_studio/session`'s own whoami body, the last surface that used to trust token claims — authorizes from ONE declared per-route table (`dev-access.js`) with an admin-only default, "any" meaning no-auth-at-all rather than a role tier, and roles resolved from the live directory everywhere, never the token; engine capabilities are declared (`CAPABILITIES`/`capabilitiesFor`, fail-closed for unknown engines) and a non-transactional-DDL dialect refuses the structural path — dry-run included — before any statement runs; roles resolve per REQUEST from the live directory for token-bearing callers, so revoking/deleting a user's row takes effect on their very next call without re-issuing the token (this does NOT cover API keys, whose roles come from `config.api_keys[].roles` and are operator-managed rather than directory-revocable, nor an already-open SSE subscription, which captures its ctx once at connect); `/_studio/users` add/role-set writes the `nexus_user` directory row (not just `nexus.config.json`), so a Studio-provisioned identity can actually complete the ZEN handshake past first boot, instead of reporting `applied: true` for an identity that cannot log in; webhooks are http(s)-only at write and dispatch time, timeout-bounded, non-redirecting, and the signing secret never enters the job ledger; both servers cap pre-auth request bodies, the challenge map is swept and capped under a flood, and production refuses to boot without a real `token_secret`** | **SYS-10/11/12/13, AUTH-STRANGER, DPL-PERMLEVEL, DPL-ASYMMETRIC, SITE-BACKUP, OPS-10, STUDIO-08/09/09a/10/11/12, ADP-CAP, MIG-NOTX, AUTH-REVOKE, AUTH-REVOKE-DELETE, WH-04/05/06/07, START-BODY/CHALLENGE/SECRET** |

## Unfinished / known drift (honest list, 2026-07-20)

- **Issue #9's Criticals are closed; the rest is tracked, not fixed.** The
  security-hardening spec closed C1-C5 and the security-class Importants
  (I1-I5, I10). Everything below in this section that traces back to issue
  #9 — I6 through I9, I11, backup streaming, WAL/busy_timeout, rate
  limiting, TOCTOU, and SSE fan-out cost — is
  deliberately **deferred to a follow-up spec**, not silently dropped. None
  of it is a privilege-escalation or auth-bypass path; all of it is
  correctness/robustness debt.
- **I6 — `Threads.queues` can leak on job timeout**: a job whose handler hangs
  past its own timeout leaves its entry in the in-memory `Threads.queues` map;
  nothing currently reaps it. Not fixed by this spec.
- **I7 — writes are not atomic with embeddings/hooks**: `Data.create`/`update`
  commit the row first, then run embedding generation and `after:` hooks; a
  crash or throw between them leaves the row persisted without its embedding
  or without the hook's side effect having run. Not fixed by this spec.
- **I8 — entity delete is non-atomic and swallows errors**: cascade delete
  removes rows entity-by-entity rather than in one transaction, and a
  mid-cascade failure on one entity does not roll back rows already removed
  from prior entities in the same cascade. Not fixed by this spec.
- **I9 — `hotApply` runs outside a transaction**: applying a schema change to
  a live table is a sequence of DDL statements with no transactional envelope
  on engines that support one; a failure partway leaves the table between
  states. Not fixed by this spec (related to, but distinct from, C5's
  `transactionalDDL` capability check, which guards the *migration* path, not
  hot-apply).
- **I11 — `after:remove` id leak — already disclosed above**: see the
  "document-level" bullet further down in this list (unchanged by this spec;
  restated here only so issue #9's Importants are all accounted for in one
  place).
- **Backup streaming/memory is unfixed, and now touches MORE tables**: C3
  made backup complete (system entities are now included) and secret-safe,
  but did not change its shape — it still `SELECT *`s an entire table into
  one in-memory JSON document per entity, now across a strictly larger table
  set than before. A large `nexus_job`/`nexus_notification` table makes this
  worse, not better. Streaming is the fix; not built here.
- **SQLite WAL mode + `busy_timeout` are not configured**: concurrent writers
  against the built-in sqlite engine can hit `SQLITE_BUSY` under contention;
  no journal mode or busy-timeout tuning has been added.
- **No rate limiting anywhere**: `/_auth/challenge`, `/_auth/verify`, and
  every `/api/v1/*` route accept requests at whatever rate the network
  allows. The body-size and challenge-map caps (START-BODY/CHALLENGE, this
  spec) bound memory, not request rate — a client can still hammer the
  endpoints as fast as it can open connections.
- **TOCTOU on update/remove**: the permission check and the write are not one
  atomic operation — a row's data (and therefore whether a row-level `rule`
  or `ifOwner` still matches) can change between the read that authorizes the
  request and the write that executes it.
- **SSE fan-out cost is unbounded by subscriber count**: `/api/v1/_events`
  broadcasts every eligible event to every open subscriber with no backlog
  cap or slow-consumer handling; a large number of idle-but-connected
  subscribers all pay the cost of every write.
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
- **`after:remove` permission check is document-level, and the leak bound is wider than "a row
  seen moments earlier"**: `Permission.resolve` returns `{allowed:true, filter}` whenever ANY
  permlevel-0 policy applies to the action; the row-restricting `rule`/`ifOwner` survive only in
  `filter`, which the doc-level remove check discards. So any subscriber with document-level read
  on an entity learns the id of ANY removed row of that entity, regardless of row-level
  restrictions — not bounded to rows that subscriber could actually have read. Documented in spec
  §1 as a known tradeoff; a `before:remove` hook capturing the row would close the asymmetry
  entirely (v2 note).
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
