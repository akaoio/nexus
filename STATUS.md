# Nexus — Status

Spec-first (conformance clauses written RED before code, N6). Every claim below
is backed by a passing clause on real infrastructure — no stubs, no fakes.

**Green: 540/593 node clauses, 0 red.**
(53 node "skips" are browser-only clauses plus the gated real-model suites —
EmbeddingGemma/FunctionGemma run where `test/.engines` has the library.)

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
| **System entities** | **nexus_user/role/policy/view are ordinary Model Schema v1 docs on the SAME pipeline; shipped baselines (admin bundle per loaded entity, self-service via $CURRENT_USER rule); bootstrap import; directory-backed auth**; **permissions editor edits nexus_policy ROWS through the plane — layered read window /_studio/policies, additive-union contract pinned, bespoke POST dead** | **PERM-U01, SYS-06..08, STUDIO-04/06/07, POLWIN-*** |
| **Entity lifecycle** | **/entities directory (list view), cascade DELETE behind a pure dry-run plan + typed confirm; hot reload — entity CRUD never restarts dev; field `span` (form grid) + `views` opt-in in Model Schema v1** | **LIFE-*, MS-S12/13** |
| **Roles** | **role = named policy bundle; rolesIn() overview; /roles + multi-role /users pages over plain entity rows** | **ROLE-*** |
| **Saved views (§7)** | **persisted through the Data Plane (permissioned, ownable); applyView reconstructs the list** | **VIEW-*** |
| AuthN | API keys; challenge-sign; HMAC tokens; role mapping; **WebAuthn PRF → deterministic ZEN identity** | AUTH-*, **AUTH-PRF-*** |
| Kernel / CLI / Studio | extracted from akao; real-process CLI; full tabbed Studio (Data+Ask/Form/Search/Schema/Permissions) in `nexus dev` | KRN-*, CLI-*, NX*-* |
| HTTP + serving | auto API (`/query`, `/search`, `/ask`); `/_health`; request logging | API-* |
| **Production server** | **`nexus start` — refuses god-mode (E_NO_AUTH), TLS-required (E_NO_TLS/--insecure), auth-enforced, no Studio/framework exposure, self-served HTTPS** | **START-*** |
| Security | pentest findings pinned as clauses (info-disclosure, oracle, static-serve) | SEC-* |
| **Install/lifecycle** | **one-line installers (install.sh / install.ps1, GitHub-first, tarball fallback, npm never required); `nexus update` (git fetch+hard-reset, the access pattern) and `nexus uninstall --yes`** | CLI-* (help pin) |
| **Entity identity** | **schema `icon:` (any bootstrap-icons name — vendored 1.1 MB sprite, nx-icon registry-first with sprite fallback); picker in the /entities editor** | MS-S14 |
| **Effect engine** | **durable jobs as `nexus_job` rows (token-CAS claim, backoff, DLQ, recurring), Threads execution behind the narrow plane-RPC, webhook/mail/notification consumers as the effect app, Studio /jobs** | SYS-09, JOB-*, EXT-J1, THR-*, JOBL-*, WH-*, MAIL-*, NOTIF-* |
| **Realtime** | **public SSE `/api/v1/_events` (auth'd incl. `?token=`, per-subscriber plane-gated, no row data on the wire, heartbeat); Studio live refresh on every list route via the public stream; dev `/__dev_events` + watcher + full module hot-swap + `"reload"` on schema hot-apply** | **EVT-U*, EVT-*, HMR-*, DEVE-*** |

## Unfinished / known drift (honest list, 2026-07-19)

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
- **`/_studio/users` endpoints are legacy**: the /users page now CRUDs `nexus_user`
  rows, but the old config-identities endpoints remain in dev.js for CLI parity.
  Deciding their fate (keep as bootstrap tooling vs delete) is open.
- **Component discipline is not yet total** (the pre-Huy akao bar): sidebar entries are
  now `<nx-navlink>` and the shell composes components, but hand-built DOM remains in
  several routes (users list rows, roles cards, entities editor chrome, settings/general
  form) and in kit/fields.js editors. These should become components or route templates.
- **Studio auth gate is boot-time** (`studioAuthAtBoot`): flipping auth ON live protects
  the data API immediately, but `/_studio/*` write endpoints only start demanding a token
  after the next dev restart.
- **Hot reload leaks one sqlite handle per reload** (dev-only, documented in dev.js).
- **FunctionGemma zero-shot quality is weak** for the recursive filter grammar
  (Vietnamese asks often refuse; compound English often malforms — safely rejected by
  translate() and covered by the tier chain). Fine-tuning on the filter dialect is the
  intended path (spec notes it); `dtype` for the generator is also not pinned yet. Enabling it no longer requires hand-editing config (MODEL-07..09).
- **Realtime event replay is not implemented** (`Last-Event-ID` v2 is deferred): reconnecting
  clients refetch the full list rather than resuming from a checkpoint. The event stream is
  append-only and durably stored; replay is an optimization.
- **`after:remove` permission check is document-level** (the row is gone when subscribers check):
  the asymmetry (removed rows do not leak in the stream, but the permission grammar lists them)
  is documented in spec §1 as a known tradeoff in the permission model.
- **In-browser swap loop (CSS/template/module HMR) is verified by hand** in Chrome, not pinned
  in CI — the module hot-swap mechanism is proven on the real infrastructure (DEVE-02/03), but
  the browser-side application of those swaps (entry point reexecution, style reinjection) are
  joins to the E2E debt alongside login/cascade/hot-reload/accent clauses.
- **Studio route unsubscribe relies on the router's teardown behavior** (found in Task 3): subscriptions
  ride ONE shared EventSource and stale routes self-reap on their first event after a navigation.
  A structural router unmount hook (`src/studio/app.js:181`) is the proper cleanup pattern.
- **App-file changes broadcast a full `reload`** (apps/ is not browser-served): only framework files
  (`/_nexus/src/{studio,core}`) hot-swap at the module level. Schema hot-apply triggers `"reload"` to
  ensure app logic sees the new schema before any user action.
- **Studio router has NO unmount hook** (`src/studio/app.js:181`): subscriptions self-reap on their
  first event after a navigation rather than closing cleanly. A real teardown hook is the structural
  follow-up (architectural debt, documented).
- **Token is re-read from localStorage only on reconnect**: mid-session re-login updates the token,
  but the shared EventSource connection keeps the old token until the entity union changes and
  triggers a disconnect (by routing or by permission shift).
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
