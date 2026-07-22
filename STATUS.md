# Nexus — Status

Spec-first (conformance clauses written RED before code, N6). Every claim below
is backed by a passing clause on real infrastructure — no stubs, no fakes.

**Green: 763/813 node clauses, 0 red** (`node test.js`)
**Green: 50/50 browser clauses, 0 red** (`npm run test:browser`, real headless Chromium)
**Green: 9/9 end-to-end clauses, 0 red** (`npm run test:e2e`, real browser driving a real `nexus dev`)

Three runners, three verdicts, all stated — because until this was checked, only
the first was. Each sees something the others cannot: the node suite never opens
a page, the browser suite never talks to a server, and the end-to-end suite is
the only one that loads the Studio's real module graph against a live instance. The 47 node "skips" are the browser clauses plus the gated
real-model suites (EmbeddingGemma/FunctionGemma run where `test/.engines` has
the library); the node summary now names the browser verdict at the moment it
skips them, so a green node run can no longer read as "everything passed".

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
| **Install/lifecycle** | **one-line POSIX installer (install.sh — GitHub-first, tarball fallback, npm never required); `nexus update` (git fetch+hard-reset, the access pattern) and `nexus uninstall --yes`. Verified end to end on a clean machine** | CLI-* (help pin), INST-*, POSIX-* |
| **Entity identity** | **schema `icon:` (any bootstrap-icons name — vendored 1.1 MB sprite, nx-icon registry-first with sprite fallback); picker in the /entities editor** | MS-S14 |
| **Effect engine** | **durable jobs as `nexus_job` rows (token-CAS claim, backoff, DLQ, recurring), Threads execution behind the narrow plane-RPC, webhook/mail/notification consumers as the effect app, Studio /jobs** | SYS-09, JOB-*, EXT-J1, THR-*, JOBL-*, WH-*, MAIL-*, NOTIF-* |
| **Realtime** | **public SSE `/api/v1/_events` (auth'd incl. `?token=`, per-subscriber plane-gated, no row data on the wire, heartbeat); Studio live refresh on every list route via the public stream; dev `/__dev_events` + watcher + full module hot-swap + `"reload"` on schema hot-apply** | **EVT-U*, EVT-*, HMR-*, DEVE-*** |
| **Install lifecycle, part 3 — tarball integrity (issue #8)** | **a tarball install is now IDENTIFIABLE: the branch is resolved to a commit and that commit's archive is fetched, so the recorded SHA is exactly the tree on disk rather than whatever `main` pointed at by the time the second request landed. Not signature verification and not claiming to be — TLS plus GitHub identity stays the trust root, since a home-grown signing scheme is key custody to maintain forever and a neglected one looks like protection. Implementing it surfaced a separate hole the answer had not mentioned: `curl … \| tar -xz` under `set -e` cannot see a failing curl, because a POSIX pipeline reports its LAST command's status — so a download that wrote a complete-looking stream and then failed left tar exiting 0 and the install proceeding. The download now goes to a file whose status is checked before anything is extracted. An unresolvable commit degrades to an unidentified install that SAYS so and records `commit: null`, rather than refusing** | **INST-10..13** |
| **Install lifecycle, part 2 — the service (issue #8)** | **`nexus service install \| status \| uninstall` supervises `nexus start` across reboots with NO root: a `systemd --user` unit (`Restart=always`, `WantedBy=default.target`) plus `loginctl enable-linger`, which was verified to need no root on Linux (`set-self-linger` carries `allow_any=yes`) — the fact the whole no-sudo story rests on, checked rather than assumed. Linger failure is a WARNING that still installs, never an abort (the access lesson). Where systemd is absent it degrades to ONE marker-based `@reboot` cron line, never both, because a second supervisor for a long-lived server is not redundancy but a duplicate process — which is also why access's 5-minute timer is deliberately not copied. macOS and Windows refuse with `E_SERVICE_PLATFORM` and say what to run instead. `nexus update` restarts what the MANIFEST recorded, with `try-restart` so a unit an operator disabled stays disabled. Decision and execution are split, so the clauses assert the behaviour without enabling a process on whoever runs the suite; `systemd-analyze verify` confirms systemd itself accepts the generated unit** | **SVC-01..09** |
| **Install lifecycle, part 1 (issue #8)** | **the installer now records what it changed and `uninstall` undoes exactly that: `$NEXUS_HOME/.state/install.json` names the shims and PATH entries, so a shim at a non-default `NEXUS_BIN` is found — the old guess missed it and left a `nexus` on PATH pointing at a deleted tree. No manifest means an older install, which still uninstalls by the documented defaults and says which authority it used (N3). Both hard-resetting paths now refuse to destroy unexamined work: `install.sh` before any network call (`NEXUS_FORCE=1` overrides) and `nexus update` before any reset (`--force`). Updates are serialised by an atomic `wx` lock that reclaims a dead holder rather than wedging the install, and record `{channel, ref, commit, at}` so `nexus doctor` — now two scopes in one command — can finally answer when the framework last updated and through which channel** | **INST-01..09** |
| **Studio component discipline** | **`<nx-row>` is the list-row shape as a widget (§7.1: widgets are `nx-*`, modules compose them). Four routes — users, jobs, permissions, settings/ai — each spelled the same markup out by hand in about a dozen `createElement` calls the others could not reuse. It stays in the LIGHT DOM, like `nx-navlink` and for the same reason: the row's appearance is page-level CSS, and a shadow root would cut it off from the stylesheet that gives it its shape. `lead`/`tail` are properties rather than slots because light DOM has none and `paint()` owns the children. The detail line — several optional parts with the absent ones dropped — is logic rather than markup, so it lives in a DOM-free module a Node clause can reach, while the rendering is asserted in a real browser. NXROW-02 is an invariant keyed on `.nx-who`, the thing that actually identifies a row, so a metadata block that merely uses the `.nx-pub` text style is not forced into a component it is not** | **NXROW-01..03, NXROW-DOM01..03** |
| **Studio build lifecycle** | **a built Studio now records what it was built FROM (`build.json`: framework version + commit, and a deterministic fingerprint over the baked schemas), because it is a snapshot of (framework source × instance schemas) that recorded neither — so `nexus update` moved the framework under every build in the world and editing a model moved the schemas, both in silence, and a built Studio could serve old code against a new server while rendering forms for fields that no longer existed. The comparison is a pure function over data, so every case (no stamp, moved commit, changed schemas, both at once) is driven without booting anything; an install with no git checkout REPORTS the dimension it could not check rather than claiming freshness. `nexus start` warns and still serves — the data plane never reads the built tree, and refusing an API because an admin UI is stale would be the worse failure — `nexus doctor` reports it as a check, and `nexus update` names what it just invalidated since it cannot reach instances to fix them. `create` writes a `.gitignore` covering what it and the build generate** | **STAMP-01..06, CREATE-STUDIO-01/02, CREATE-GITIGNORE, UPDATE-STUDIO-01** |
| **dev teardown & reload hygiene** | **`buildInstanceApi` finally has the destructor it never had: `openInstanceData` opened the database INSIDE it and nothing outside ever held the handle, so dev's hot reload — which rebuilds the whole instance surface on every schema write — had no way to release the one it replaced. The comment claiming it was "left to the GC" was not describing what happened: the closure holding it stays alive as long as the plane built from it, so it was retained and unreachable. Measured at 3 → 17 descriptors on the same file over five reloads; it now plateaus. Reload order reversed with it — BUILD first, release second — because the old order stopped the previous instance's effects before the rebuild, so a rebuild that threw (a malformed model file dropped into apps/ is enough) left dev serving from a plane whose job runner was already dead, saying nothing. And `dev` now has the SIGINT/SIGTERM teardown it declined, on the reasoning that "the spawned dev process is SIGKILLed by callers/tests" — which describes the harness, not the developer pressing Ctrl+C, who got a process that died by signal with its write-ahead log still on disk. `nexus start` had the handlers but closed only the server, so a `systemctl stop` abandoned the WAL in production too** | **DEVFD-01/02, DEVDOWN-01..03, STARTDOWN-01** |
| **Restore reads incrementally** | **the read half of the round trip: `restore` used to `readFileSync` + `JSON.parse` the whole document, costing it TWICE — once as a UTF-8 string, once as the parsed graph — so a backup big enough to be worth having was exactly the one that could not be restored, and the asymmetry was invisible because it works on every backup anyone tests with. A SCANNER rather than a parser: the hand-written part does one job, finding where a JSON value ENDS (depth tracking that is aware of strings and their escapes, which is why it cannot be a bracket count), and hands the slice to JSON.parse — so no hand-rolled number, escape or unicode handling can be subtly wrong. DOM-free and stream-free, strings in and events out, so the case incremental readers actually break on is a plain Node clause: the same document fed ONE CHARACTER AT A TIME must yield identical events, which found a real rewind bug on its first run. A truncated document throws rather than reporting a partial success, because a restore that applies half a backup is worse than one that fails. Measured decisively both ways on an 80MB document under a 96MB heap: the old approach dies with V8's heap-limit trace, the new one restores all 200 rows in about four seconds. The database is opened LAZILY — after the backup's apps/ have been written, or an app restored from the backup contributes no schemas and every row is fitted against an entity that does not exist** | **BREAD-01..05, SITE-STREAM-03** |
| **End-to-end (browser × live server)** | **`npm run test:e2e` — a real headless Chromium driving a real `nexus dev`, and the only runner that loads the Studio's actual module graph against a live instance: the browser clauses never see a server, the subprocess suites never see a page. It reaches live module state by `await import()`ing the very module the app loaded (ESM keeps one instance per realm per URL), so E2E-02 reads the running app's subscriber set and proves a route's subscription really closes on navigation — the gap the route-lifecycle work declined to claim. Also pinned: the dev loop (a schema saved to disk reaching the running page), cascade delete refusing a wrong typed confirmation, and the first-admin journey end to end through the Studio's own UI — the button provisioning an identity, authentication turning on, a wrong passphrase refused, and the right one deriving the key in the browser, signing the challenge and returning an admin session. Three of the clauses had their ability to FAIL verified by breaking what they pin. The CDP driver is shared with the browser runner rather than copied. Wired into CI alongside both other runners** | **E2E-01/02/03** |
| **Studio lifecycle & keyboard access** | **the router has a real unmount hook (`kit/lifecycle.js`): routes register teardown with `onUnmount()` and the router brackets each render, so leaving a page releases what the page took — subscriptions AND the burst-collapse timers the old `host.isConnected` incantation was shape-blind to. Re-rendering the same route (a locale change) unmounts first rather than accumulating; a teardown that throws is contained the way the event hub and the plane's after-hooks already are; an invariant clause over `src/studio/routes` keeps the old pattern from creeping back. The shared EventSource's union is asserted to NARROW on unsubscribe, not merely widen on subscribe — the header used to claim otherwise. And the search overlay, which had no keyboard handling of any kind, is now operable without a mouse: wrapping arrow navigation, Home/End, Enter emitting the chosen record, Escape clearing, with listbox/option roles and `aria-activedescendant`** | **LIFE-UNMOUNT-01..04, EVT-UNION-01/02, NXSR-KEY-01/02** |
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

**10. The Studio's auth gate read a boot-time snapshot, so turning auth ON left
it open until the next restart.** `/_studio/*` checked a `studioAuthAtBoot`
constant captured once at startup, and a comment explained the reasoning: a
session that booted open should stay usable while you configure authentication
from it. That reasoning was written down, deliberate, and wrong — because
`/_studio/config` writes arbitrary dot-paths into `nexus.config.json`,
`token_secret` included. So on a dev server anyone on the LAN could reach, the
gap between adding the first admin (which locks the DATA API immediately) and
the next restart was a window in which a stranger could rewrite the signing
secret and mint whatever tokens they liked. The window it was protecting turns
out to be about a second wide: the users page reloads itself into the login
gate, and the passphrase you just chose is the one that opens it. The gate now
reads `authState.required` live (STUDIO-14, verified by restoring the snapshot
and watching the clause go red). USER-03 changed shape with it — provisioning
through the legacy `/_studio/users` endpoint now locks that endpoint behind the
identity it just created, so the clause holds a REAL keypair and signs in to
carry on, which is also the recovery path an operator would walk.

**9. `nexus dev` never noticed a model file added by hand.** `assetKind()`
returned null for `.json` — the format the Studio itself writes — so a schema
file appearing in `apps/` was the one change the watcher ignored completely.
The Studio's own create path worked, because it calls `reloadInstance()`
explicitly; a file dropped in by an editor did not, so what "hot reload" meant
depended on who wrote the file. Even once the watcher saw it, the server never
re-read the instance on an app-file change, so the browser was told to reload
and came back to the SAME schema list. Both halves are fixed, pinned by
HMR-JSON01/02 under Node and by E2E-04 end to end; E2E-04's ability to fail was
verified by reverting the `.json` case and watching it go red.

**8. The rate limiter throttled the Studio into a page that could not boot.**
Every path that was not `/_auth/` took the `api` tier, including the framework
source in dev (`/_nexus/*`) and the built assets in production (`/studio/*`). A
Studio boot pulls four hundred-odd ES modules in one burst, so the module graph
became a wall of 429s and the shell never rendered — in BOTH servers, on `main`,
since the resource-bounds chunk. Nothing caught it: the browser suite runs
against static files and never sees a server, the subprocess suites never load a
page, and the manual check that "dev serves /users 200" verified the HTML shell
rather than the module graph behind it. The first end-to-end run found it.

The fix needed two goes, and the second is the more instructive. Adding an
`asset` tier to `TIERS` did nothing, because `limiterFor()` listed its tiers by
HAND — and `check()` falls back to the TIGHTEST tier for a name it does not
know, so the most generous tier silently became the strictest and the Studio was
throttled to twenty requests. Fail-closed is the right default; a tier that can
be forgotten is not. The limiter is now built from `TIERS`, and RATE-11 asserts
that every declared tier reaches it and that every answer `tierFor()` can give
names a tier that exists.

**7. `nexus update` would hard-reset a developer's own working tree.** It is not
cwd-scoped — it resets the installation the binary belongs to, wherever that is
— so running it from a nexus checkout discards uncommitted work with no warning
and no way back short of the reflog. `install.sh` already refused a dirty tree;
there was no reason the other hard-resetting path should not, and the guard had
simply been applied to one of the two. Found by a clause of mine that assumed
cwd-scoping and reset a live worktree while this chunk was being written; the
clause was rewritten to assert the guard *without* invoking the command, since
running it is precisely the accident it describes (INST-09, `E_UPDATE_DIRTY`).

**6. The background embedding drain never ran on an idle process.** Its timer
was unref'd, on the reasoning that a pending drain should not hold a CLI process
open — but an unref'd timer does not keep the event loop alive, so whenever the
process had nothing else pending the drain never ran and `embeddingBackfill`
never settled, leaving the corpus permanently half-embedded. That is exactly
what SEM-CAP-02 exists to prevent, and SEM-CAP-02 could not have caught it:
inside a full suite run there is always other pending work, so the property held
by accident. Caught by CI on its first run, on Node 24, as exit 13. Pinned by
SEM-CAP-04, which spawns a child whose loop contains nothing but the drain.

**5. The browser conformance suite was RED, and the headline said "0 red".**
`SEM-10` had been failing since the square-tint redesign changed the search
result header from `note (1)` to `note · 1` and the empty state from
`no matches` to `No matches for …`. Nothing caught it because `node test.js`
skips `{ browser: true }` and nobody ran `npm run test:browser` — so the
project's headline number was true for one runner and silently untrue for the
other. Found by running it for the first time on Linux. The clause now asserts
the SUBSTANCE (grouped per entity, count, label, score, an empty state that says
so) rather than punctuation a redesign is entitled to change, and the node
summary now names the second verdict wherever it skips.

**4. `nexus site backup` reported eight entities and wrote one.** On a fresh
instance the system tables do not exist yet — they are created when a server
first boots — so `isMissingTableError` correctly skipped them. But the summary
counted every schema it *intended* to back up. C3 made backup complete; it did
not make the report honest, and a backup that overstates itself is discovered at
the worst possible moment. The count is now what the file actually holds, and
anything left out is NAMED (SITE-COUNT-01).

**What the ten share.** Every one is a guarantee stated in a comment, a header,
or a clause — and exercised only on the engine, the path, the route, the runner,
or the moment where it happened to hold. Four levels are worth telling apart,
because each needed a different instrument to see: a claim never checked
anywhere (1–4), a whole suite never run (5), and a clause that was green **for
the wrong reason** (6) — that last one only visible by giving it a process whose
event loop contained nothing else. (10) is a fourth and the least comfortable:
a guarantee that was never claimed, because the comment accurately described a
gap someone had decided to accept. No clause could catch that one, since no
clause was being contradicted — it needed the trade-off re-weighed against what
the open surface could actually write. (7) is the one that bit hardest: it was found
by a test destroying real work, which is the most expensive way to learn that a
guard belonged on two paths and had been written for one. Nine of the ten were
NOT found by reading the code with suspicion — the audit did that thoroughly and
missed every one. They were found by writing a clause that asserted the stated
guarantee somewhere it had never been asserted before. (10) is the exception,
and it is worth being precise about why: reading found it only because the
comment was honest about the gap, so the question left to ask was not "is this
true?" but "is this trade still worth making?" That
is the argument for spec-first stated more precisely than "tests are good": a
clause is worth writing exactly where a claim has never been checked, and the
places nobody thought to check are where these live.

## Unfinished / known drift (honest list, 2026-07-22)

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
- **Restore streams too, with one honest exception.** `data.<entity>[]` — the
  only unbounded region — arrives one row at a time; the header is scalars,
  `apps` is the instance's own source files, and `migrations` is one entry per
  applied migration, so those three still arrive whole. An instance with a
  pathological apps/ tree still pays for apps/. Saying "restore streams" without
  that distinction would overstate it.
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
- **`nexus studio build` stays on-demand, and that is now a decision rather than a gap.**
  The spec (§2.4) anticipated wiring it into `create` and `update`; neither wiring is what it
  looked like. `update` CANNOT rebuild — it updates the framework installation the binary
  belongs to and holds no register of the instances running against it, so there is no list to
  walk; what it actually does is invalidate every build in the world, silently. And building at
  `create` was implemented, then withdrawn: `/` is a Studio route and `nexus start` checks the
  built Studio BEFORE the static handler, so a build present means the site root serves the
  Studio shell — pre-authentication, with full schema documents baked into its boot payload.
  Building by default would have turned a surface an operator chose into one every instance
  has, as a side effect of a task described as wiring. What was a real gap — that nothing told
  you the command existed — is closed: `create` names it in Next steps, `start` names it on an
  instance with no build, and `doctor` reports it.
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
- **Component discipline: the row shape is a component now; the remaining
  hand-built DOM is layout, not repeated widgets.** `<nx-row>` replaced the same
  markup rebuilt in FOUR routes — users, jobs, permissions and settings/ai — each
  spelling out a `.nx-row` around a `.nx-who` label-over-`.nx-pub`-detail block
  in about a dozen `createElement` calls the others could not reuse. NXROW-02 is
  an invariant over `src/studio/routes`, keyed on `.nx-who` rather than on
  `.nx-pub`: the latter is a text style, and `entity/[entity]`'s id/owner/created
  metadata block uses it legitimately without being a row. Banning the class
  outright would have forced a row component onto something that is not a row.
  The entities editor chrome and the settings form are done too, and the earlier
  reading of them was WRONG. That pass counted `createElement` calls and
  concluded they were "layout shapes that appear once each, so there is no
  repeated widget to extract". Reading them found the duplication was not a
  WIDGET repeated across routes — it was two PRIMITIVES redefined in every file
  that needed them: the `.nx-field`+`.nx-label` wrapper and the `.nx-input`
  control existed in FOUR copies (kit/fields.js had one inside `buildForm` and
  one private, and settings, entities and entity/[entity] each had their own).
  Changing what a labelled field looks like meant finding four places and
  hoping. The kit now exports `control`, `fieldWrap` and `labelledField`;
  NXFP-01 is an invariant over all of `src/studio`, keyed on the CLASSES,
  because that is what makes two blocks of DOM the same thing to a reader and to
  the stylesheet.
- **(earlier) The users FORM is generated from the schema.** §7.1's rule is "sinh UI từ schema" — a new field kind is a registry
  entry, never per-entity UI. `routes/users` was the worst violation (a hand-built form
  including its own roles picker, ~20 `createElement` calls no other entity could reach)
  and now calls `buildForm()` with one documented per-field override. NXFR-04 is an
  invariant, so putting a picker back inside a route fails a clause. Still hand-built:
  the users/roles LIST rows and cards, the entities editor chrome, and the settings form.
  Those are list/layout shapes rather than field editors, so they want route templates or
  components rather than the field registry — a separate piece of work.
- **The override seam is a seam, and it could be abused.** `buildForm({ interfaces })`
  points ONE NAMED field at an interface that is itself registered. Nothing stops a future
  caller passing an inline closure and re-inventing per-entity UI through it; the clause
  checks that routes do not rebuild pickers, not that every override is registered. The
  honest reason it exists at all: `nexus_user.roles` is a `text` column holding JSON and
  Model Schema v1 is frozen (N4), so giving it a real field type is a format version, not
  an afternoon.
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
- **CLOSED — the Studio router has an unmount hook** (`src/studio/kit/lifecycle.js`). This entry
  used to disclose that stale routes self-reaped on their first event after a navigation. Reading
  it found the cost was larger than the description: five routes carried the same
  `if (!host.isConnected) return unsubscribe()` line, which releases a subscription only when the
  NEXT event arrives — so on a quiet instance a navigation leaked a subscriber permanently — and
  the pattern was subscription-shaped, so the `setTimeout` those routes also hold was never
  released at all and could fire `load()` against a dead route. Routes now register teardown with
  `onUnmount()`; the router brackets each render. A teardown that throws is contained. NXSR-KEY-02
  is an invariant over the source, so the old incantation cannot creep back (LIFE-UNMOUNT-*).
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
- **CLOSED — the search overlay is keyboard-operable** (NXSR-KEY-01). This entry understated it:
  the component had NO keyboard handling of any kind — no `keydown`, no `tabindex`, no `role`, no
  `aria-*` — so a keyboard or screen-reader user could not reach a result at all. That is an
  accessibility defect, not a missing convenience. Arrow/Home/End navigate (wrapping at both ends,
  ArrowUp from nothing opening the last hit), Enter emits `nx-open` with the chosen record, Escape
  clears; the results are a `role="listbox"` of `role="option"` hits with `aria-activedescendant`
  tracked on the input. The navigation rule is a pure function asserted under Node rather than a
  browser-only clause nobody runs.
- **Still open: the legacy `/search` page duplicates the overlay component**, and the overlay
  should eventually own result actions rather than only announcing the choice.
- **The teardown is proven by clause and by boot, NOT yet by a browser click-through**: the
  lifecycle logic, the union narrowing and the key handling all run under Node, and the built
  Studio boots with the new kit — but "navigate away and observe the subscription actually close"
  joins the existing E2E debt below rather than being claimed here. The search overlay's half IS
  now proven in a real browser (SEM-11: listbox/option roles, `aria-activedescendant` tracking,
  arrow selection, Enter emitting the chosen record); the router's half is not.
- **The browser suite is green here, and that is a per-machine claim**: it needs a real Chromium
  and runs over CDP. It is green on this Linux box; an environment without a browser exits 3 (no
  browser found) rather than pretending.
- **ZSYNC's CI flakiness is FIXED, and the cause was not "timing" in general.**
  The harness slept a fixed 3s to "let the WS wire meet the relay" and then
  appended. On a loaded runner that was not always enough, and an event appended
  before the wire carried anything went nowhere and was never re-sent — so the
  FIRST assertion failed permanently while later ones passed. The CI signature
  was unmistakable once read: ZSYNC-01 red, 02 green, 03/04/05 red because they
  depend on r1. It now waits on an OBSERVABLE condition: a probe event
  converging is what "the peers have met" means, and if it never does the
  harness says exactly that instead of leaving four assertion failures to
  interpret. Verified by three consecutive runs under deliberate CPU load.
  The two negative assertions (idempotence, tamper rejection) also stopped
  resting on a sleep — a forgery that was never delivered is not a forgery that
  was rejected, so each now waits for a sentinel published after it to land
  before concluding the row is unchanged. And the relay retries its BIND on a
  fresh port, never an assertion: a port collision says nothing about the code,
  while re-running an assertion is precisely the habit this suite was teaching.
- **CI exists (`.github/workflows/conformance.yml`) and has now RUN — and caught a real defect on
  its first attempt.** On Node 24 it failed with an unsettled top-level await (exit 13): the
  background embedding drain's timer was unref'd, so on an otherwise-idle process the drain never
  ran and `embeddingBackfill` never settled, leaving the corpus permanently half-embedded. That is
  the exact failure SEM-CAP-02 was written to prevent, and SEM-CAP-02 could not have caught it —
  inside a full suite run there is always other pending work keeping the loop alive, so the
  property held by accident. Fixed, and pinned by SEM-CAP-04, which spawns a child whose loop
  contains nothing but the drain. Node 22 passed the whole workflow including the browser suite,
  which also settles the one assumption stated below as unverifiable from here.
- **Historical note on that workflow's arrival:**
  until it was added there was no automated run behind 748 clauses and twelve merged PRs at all —
  which is how the browser suite went red unnoticed. The workflow gates on BOTH runners across
  Node 22 and 24, installs the live-engine drivers as a hard step (so a broken install fails the
  job instead of quietly turning live-engine clauses into skips), and treats the browser runner's
  exit 3 as a failure, because a browser suite that did not run is not one that passed. What was
  verified locally: the YAML parses, the pinned driver ranges resolve, `NEXUS_BROWSER` is honoured
  by the runner, and the exit-3 path exists. The one thing that could NOT be verified from here —
  whether GitHub's `ubuntu-latest` image carries a browser — is now OBSERVED: the Node 22 job ran
  the browser suite green. The "Locate a browser" step still fails loudly with instructions if a
  future image drops it, rather than letting the suite silently skip.
- **The real-model suites stay skipped in CI, deliberately**: `@huggingface/transformers` is not
  installed there because EmbeddingGemma/FunctionGemma download real models, which is not a
  per-PR cost. Those clauses skip in CI exactly as they do on a machine without the library.
- **E2E: three flows are pinned, the rest are still by hand.** `npm run test:e2e`
  spawns a real instance, runs `nexus dev`, and drives it with a real browser —
  the only runner that loads the Studio's actual module graph against a live
  server, which is what made it find the rate-limiter regression above. Pinned:
  the Studio booting and rendering nav from real schemas (E2E-01), a route's
  subscription actually closing on navigation (E2E-02 — the gap the
  route-lifecycle work explicitly declined to claim), and the accent surviving a
  reload (E2E-03), the dev loop — a schema saved to disk reaching the running
  page (E2E-04) — and cascade delete refusing a wrong typed confirmation before
  really removing the entity (E2E-05/05b). E2E-02's and E2E-04's ability to FAIL
  were each verified by breaking the thing they pin and watching them go red.
  and the LOGIN handshake — a wrong passphrase refused, the right one deriving
  the key, signing the challenge and returning an admin session (E2E-06/07).
  E2E-02, E2E-04 and E2E-07 each had their ability to FAIL verified by breaking
  the thing they pin and watching them go red.
- **The whole first-admin journey is now driven through the Studio's own UI**,
  and the two earlier passes that called the "add me as admin" button
  undrivable were BOTH WRONG — in the same way. The button always worked:
  `prompt()` stubs fine and the directory row is written immediately. What
  failed was the assertion, which counted `(json.data || []).length` on the
  response to an UNAUTHENTICATED read of `nexus_user` — and that is 401 the
  instant the first admin exists. Zero rows was the auth gate CLOSING, i.e. the
  flow succeeding, read as the flow failing. Twice. The clause now waits for the
  signal a person would notice (the API begins refusing anonymous reads) and
  E2E-08's ability to fail was verified by removing `usersByPub` from the
  `authState.required` derivation.
- **LF/CRLF warnings** on Windows commits are noisy (no .gitattributes yet).
- **Issue #8: the service landed; the APPLY path is not exercised end to end
  here.** `servicePlan()` is pure and fully clause-covered, `systemd-analyze
  verify --user` accepts the generated unit (systemd's own parser, no process
  enabled), and `nexus service status` was run against the real machine and
  correctly reported systemd reachable and `Linger=no`. What was NOT run:
  `nexus service install` itself, because enabling a real user unit is a
  system-modifying action a session should not perform unasked. So the writing,
  enabling, linger-degradation and crontab paths are covered by clause and by
  the plan they execute, not by having been executed. Stated plainly rather
  than implied by a green suite.
- **Issue #8 is fully answered and implemented.** Answers 1–4, 7, 9 landed in
  part 1; 5, 6 and 10 in part 2; 8 here. What each of them does NOT do is
  recorded in its own bullet rather than implied.
- **The tarball SHA check is identification, NOT verification, and says so.**
  TLS plus GitHub's identity remains the trust root (answer 8, ratified): no
  signing scheme was invented, because key custody and rotation is a security
  system to maintain forever and a neglected one is worse than none — it looks
  like protection. What the check buys is that a tarball install becomes
  identifiable and reproducible: the branch is resolved to a commit and THAT
  commit's archive is fetched, closing the window where a push between the two
  requests would yield a tree that is not the one recorded. It does nothing
  against a compromised GitHub, and nothing against a malicious mirror that
  serves a consistent lie.
- **Nexus is POSIX-only as of 2026-07-22; `install.ps1` was withdrawn.** It had
  never run on Windows. Executed for the first time under PowerShell on Linux, a
  real defect appeared within minutes: `git fetch` and `git reset --hard` both
  failed and it still printed "Nexus installed.", wrote a shim, and recorded a
  manifest claiming `channel: git` with the LOCAL commit — a manifest asserting
  precisely what manifests exist to prevent. `$ErrorActionPreference = "Stop"`
  does not stop on failing NATIVE commands, and Windows PowerShell 5.1 (what
  `irm | iex` hits) cannot be told to. The fix was writable but NOT verifiable
  here, so the capability was withdrawn rather than shipped as an unverifiable
  claim — the judgement STATUS already applies to MySQL. ARCHITECTURE §1.1/§5
  carry the change with its N3 cost stated; POSIX-01/02/03 keep it from drifting
  back. Kernel path portability (`WIN` in environment.js) stays: the withdrawal
  was of the installer and the promise, not of separator handling.
- **The Windows PATH entry is NAMED, not yet undone**: `uninstall` reports the
  PATH entry the manifest records and tells the operator to remove it. Rewriting
  a user's persistent PATH during an uninstall is a bigger decision than this
  chunk should make silently, so it names and defers rather than acting.
- **install.sh IS now verified on a clean machine** — a minimal Debian trixie
  rootfs (debootstrap + systemd-nspawn) with no Node and no git. All four
  prerequisite branches ran for the first time: refusal with no Node, refusal on
  Node 20, the tarball fallback (git absent) resolving and pinning a real commit,
  and the full lifecycle after it — `create`, `migrate --apply`, `doctor`
  healthy, `update` correctly telling a tarball install how to refresh, and
  `uninstall --yes` removing exactly what the manifest named while leaving the
  instance directory alone. There is no longer a Windows installer to leave
  unrun (see the POSIX-only entry above).
- **Debian stable ships Node 20, below the floor Nexus requires.** On trixie
  `apt install nodejs` gives 20.x, and the installer then correctly refuses with
  "Nexus needs Node >= 22 (node:sqlite)". That is the right refusal, but it means
  the most obvious install path on the most common server distro does not work
  without adding a Node source first — worth a line in the README that is not
  there today.
- **Node 22 prints an ExperimentalWarning on every CLI command** (`SQLite is an
  experimental feature`), because node:sqlite is only unflagged-stable later. 22
  is the DECLARED floor, so the minimum supported configuration is also the
  noisiest one. Not fixed here; suppressing warnings wholesale would hide real
  ones, and a targeted filter is a decision worth making deliberately.
- **A decision on npm publishing** (the name "nexus" is generic) is still owed.
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
