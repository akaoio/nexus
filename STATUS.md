# Nexus — Status

Spec-first (conformance clauses written RED before code, N6). Every claim below
is backed by a passing clause on real infrastructure — no stubs, no fakes.

**Green: 485/538 node clauses, 0 red.**
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
| NL → AST | rule + embedding-retrieval + **FunctionGemma-270M tier: schema as a TOOLS declaration through the chat template (Google dialect: string types + nullable), strict call parser**; validated against schema (injection-safe) | NL-*, **FG-*** |
| **System entities** | **nexus_user/role/policy/view are ordinary Model Schema v1 docs on the SAME pipeline; shipped baselines (admin bundle per loaded entity, self-service via $CURRENT_USER rule); bootstrap import; directory-backed auth** | **SYS-*** |
| **Entity lifecycle** | **/entities directory (list view), cascade DELETE behind a pure dry-run plan + typed confirm; hot reload — entity CRUD never restarts dev; field `span` (form grid) + `views` opt-in in Model Schema v1** | **LIFE-*, MS-S12/13** |
| **Roles** | **role = named policy bundle; rolesIn() overview; /roles + multi-role /users pages over plain entity rows** | **ROLE-*** |
| **Saved views (§7)** | **persisted through the Data Plane (permissioned, ownable); applyView reconstructs the list** | **VIEW-*** |
| AuthN | API keys; challenge-sign; HMAC tokens; role mapping; **WebAuthn PRF → deterministic ZEN identity** | AUTH-*, **AUTH-PRF-*** |
| Kernel / CLI / Studio | extracted from akao; real-process CLI; full tabbed Studio (Data+Ask/Form/Search/Schema/Permissions) in `nexus dev` | KRN-*, CLI-*, NX*-* |
| HTTP + serving | auto API (`/query`, `/search`, `/ask`); `/_health`; request logging | API-* |
| **Production server** | **`nexus start` — refuses god-mode (E_NO_AUTH), TLS-required (E_NO_TLS/--insecure), auth-enforced, no Studio/framework exposure, self-served HTTPS** | **START-*** |
| Security | pentest findings pinned as clauses (info-disclosure, oracle, static-serve) | SEC-* |

## Unfinished / known drift (honest list, 2026-07-18)

- **Permissions page still saves the app-file baseline** (`apps/<app>/permissions/studio.json`
  via `/_studio/permissions` POST). The live layer (`nexus_policy` rows) exists and is
  enforced (+ hot-refreshed through hooks); /roles and /users already read it — but the
  permission EDITOR has not been switched to rows yet. Until it is, Studio-edited policies
  land in the baseline file, not the row layer. (The spec said the POST endpoint dies —
  it has not yet.)
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
- **Hot reload leaks one sqlite handle per reload** (dev-only, documented in dev.js) and
  the browser page still needs a manual refresh to pick up a new boot payload (schemas)
  — the SERVER is hot, the client is not (no HMR push).
- **FunctionGemma zero-shot quality is weak** for the recursive filter grammar
  (Vietnamese asks often refuse; compound English often malforms — safely rejected by
  translate() and covered by the tier chain). Fine-tuning on the filter dialect is the
  intended path (spec notes it); `dtype` for the generator is also not pinned yet.
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
