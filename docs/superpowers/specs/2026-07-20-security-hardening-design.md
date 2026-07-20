# Security hardening v1 — design

**Date:** 2026-07-20
**Source:** issue #9 (skeptical audit) — 5 Critical, 11 Important, none covered by any clause.
**Scope:** the Criticals plus the security-class Importants. Correctness/robustness findings (I6-I9, I11) and the Moderates are deliberately deferred to a follow-up spec.

**The lesson driving every choice here:** the suite was 540 green when the audit found a live privilege escalation. Clauses pass because someone thought to ask; these holes existed because nobody asked. So **every fix in this spec lands clause-first**, and where a fix could regress silently, the clause pins the invariant rather than the symptom.

## 1. C1 — self-service must not reach `roles`

**Today:** `SYSTEM_BASELINES` grants every authenticated user `write` on their own `nexus_user` row (`system.js:199-202`, no `roles:` annotation → applies to everyone). The `roles` field has no `permlevel`, so `Permission.fields()` puts it in the writable set. Two requests promote any user to `admin`.

**Fix:** `roles` becomes `permlevel: 1` in the `nexus_user` schema. Self-service (permlevel 0) then cannot see it in its writable set; the admin bundle gains an explicit permlevel-1 policy for `nexus_user` so admins retain role management.

Chosen over a `fields: []` addition to the policy format because that would change Permission v1 — a frozen format under N4, requiring a version bump and an upgrader. Chosen over a `before:update` hook because a hook puts an authorization rule *outside* the authorization engine, which is exactly the drift this project avoids.

**Clause:** a permlevel-0 actor patching `roles` on its own row is refused; an admin (permlevel-1 policy) succeeds; the row's other self-service fields still work for the ordinary user.

## 2. C1b — `/_auth/verify` must not mint tokens for strangers

**Today:** `start.js:119-130` and `dev.js:198-208` verify only that the signature proves the key, then issue a token with `rolesForPub(pub)` — `[]` for an unknown pub. Any keypair holder gets a valid session, and the shipped directory baselines (`system.js:196-197`) then let them read every user's `pub`, `email` and roles.

**Fix:** verify refuses a `pub` that is in neither `usersByPub` (the live directory) nor `authState.identities` (the bootstrap seed) — `401 E_AUTH`. Tokens are for provisioned users; holding a keypair is not membership.

The directory-read baseline stays as-is: it is intended (the Studio's `/users` and `/roles` pages depend on it), and with strangers unable to obtain tokens it is no longer reachable by outsiders. If a self-signup flow is ever wanted, it should provision a row explicitly rather than making token issuance implicit.

**Clause:** a fresh keypair completing the challenge is refused; a provisioned pub succeeds; the refusal happens before any token is minted.

## 3. C2 — `update()` must not return gated fields

**Today:** `Data.js:265` selects with `selectAll()` and returns `{ ...current, ...patch }`, so writing one permlevel-0 field reveals every permlevel-gated field on the row. `create()` has the same shape at `:194-209`.

**Fix:** both paths select and return only the permitted field set — the same `fields` the gate already computed. The post-image predicate check keeps working: it needs only the fields the rule can reference, and a rule may only reference fields the actor can see (`#assertFilterFields`, `:296-301`, already enforces this for filters).

**Clause:** an actor with permlevel-0 write on a row containing a permlevel-1 field patches the visible field and receives a response with the gated field absent — for both update and create.

## 4. C3 — backup must be complete and must not leak secrets

**Today:** `site.js:44` iterates only app schemas, so all six system entities (users, roles, policies, views, webhooks, notifications) are **never backed up** — a restore yields data with nobody able to log in. `site.js:47` embeds the raw config, writing `token_secret` and every API key in cleartext into a file operators copy off-box.

**Fix:**
- Back up app schemas **and** `SYSTEM_ENTITIES` — the same set the server composes.
- Run `redact()` (`App/config.js:58`) over the config before embedding it, and state in the backup file that secrets were redacted so a restore does not silently produce a broken auth config.
- Restore must state clearly what it cannot restore (redacted secrets must be re-supplied).

Deliberately **not** in scope: the streaming/memory problem (`SELECT *` of the whole DB into one JSON document). That is a real defect but a different shape of work; it is recorded in the follow-up list.

**Clause:** a backup of an instance with users/roles/policies contains those rows; the emitted config carries no `token_secret` and no `api_keys[].key` value.

## 5. C4 — `/_studio/*` must authorize, not merely authenticate

**Today:** `dev.js:217-221` is `if (!claims) return 401` and nothing else. Any signed-in user of any role can rewrite schemas, delete entities, add an admin identity, or set an arbitrary config dot-path.

**Fix:** the gate requires the `admin` role for every `/_studio/*` route that writes, and for the read routes that expose instance-wide state (`/_studio/entities`, `/_studio/policies`, `/_studio/config`). `/_studio/session` stays open to any authenticated user — it is whoami and the login UI needs it.

The role check lives in **one place** (the gate), driven by a declarative per-route requirement, not scattered per handler — so a new route inherits the strict default rather than an accidental omission. **Default is admin-only**: a route that declares nothing is admin-only, never open.

**Clause:** a non-admin authenticated user is refused (403) on a representative write route and on a state-exposing read route, and permitted on `/_studio/session`; the strict default is pinned by asserting an undeclared route is refused.

## 6. C5 — engine capabilities become declared, not assumed

**Today:** `migrate.js:20` states the structural path runs "in one transaction, on every engine alike" and `:230-270` does `BEGIN` … `DROP TABLE` … `ROLLBACK`. **MySQL implicitly commits on DDL**, so on that dialect the dry run — the documented *safe default* — destroys the table it was asked only to measure.

This is a symptom of missing architecture, not a MySQL special case. `ARCHITECTURE.md:96` already names "Adapter: Kysely dialects + **capabilities**" in the layer diagram, and §4.6a already treats vector/FTS as adapter capabilities with a "capability matrix" — but no capability registry exists in code. The only capability flag today is an undeclared ad-hoc `executor.vec` (`Data.js:340`).

**Fix:** introduce the registry the architecture already promises, in `Data/adapters.js`:

```
CAPABILITIES = {
  sqlite:   { transactionalDDL: true,  vector: "sqlite-vec", fts: "fts5" },
  turso:    { transactionalDDL: true,  … },
  postgres: { transactionalDDL: true,  … },
  mysql:    { transactionalDDL: false, … }
}
capabilitiesFor(engine) → the frozen record; an unknown engine throws.
```

`applyMigration` asks `transactionalDDL` instead of assuming it. When false it **refuses the structural path entirely** — both dry-run and apply — with a clear `E_NO_TRANSACTIONAL_DDL` naming the engine and pointing at the documented alternative (take a backup, apply the migration file with the engine's own tooling). Refusing to act beats destroying data while claiming to be a dry run.

**Fail-closed by construction:** an engine added to `ENGINES` without a capability record makes `capabilitiesFor` throw, so a new engine cannot silently inherit "yes" for anything.

Folding the existing ad-hoc `executor.vec` into the registry is **in scope** only to the extent of declaring it; rewiring every vector call site is follow-up work.

**Clauses:** `capabilitiesFor` returns a frozen record per known engine and throws for unknown; every engine in `ENGINES` has a record (this is the anti-drift pin); `applyMigration` on a `transactionalDDL: false` dialect throws `E_NO_TRANSACTIONAL_DDL` and **executes no DDL at all** (asserted against a real executor recording statements).

## 7. I4 — roles resolve per request, not per token

**Today:** `server.js:287` uses `claims.roles` baked into the token at issue time (1h default TTL). Deleting a user or stripping their roles has no effect until expiry — a revoked admin keeps full write access for up to an hour.

**Fix:** the token proves **identity only**. `context()` resolves roles at request time from the live directory (`usersByPub`, an in-memory Map — the same source `rolesForPub` already reads), falling back to config identities exactly as `rolesForPub` does. A user removed from the directory resolves to no roles and therefore no policies beyond the authenticated baselines.

This deletes the whole class of revocation problems (no denylist, no token version, no state to synchronize) and makes `roles` in the token payload advisory only — kept for debuggability, never trusted for authorization.

**Clause:** a token issued while the user held `admin` no longer grants admin after the user's roles are cleared in the directory, without re-issuing the token.

## 8. I1 + I10 — the webhook consumer

**I1 (SSRF, no timeout):** `effects.js:23` fetches a row-supplied URL with no scheme check, no host policy, no redirect cap and **no timeout** — pointing it at cloud metadata or an internal port turns the job result into a readable oracle, and a hanging fetch pins a job-thread slot forever.

**Fix:** reject non-`http(s)` schemes at write time (a `before:create`/`before:update` validation on `nexus_webhook`, mirroring the `nexus_policy` validation hook already in place) and at dispatch time; add an `AbortSignal` timeout (`webhooks.timeout_ms`, default 10000); set `redirect: "manual"` so a redirect is a failure rather than a silent hop. A host allowlist is **config-driven and optional** (`webhooks.allow_hosts`) — empty means no allowlist, which is honest for a self-hosted tool, but the knob exists for deployments that need it.

**I10 (secret in the ledger):** `effects.js:60` copies `row.secret` into the job payload, so the signing secret sits in cleartext in `nexus_job.payload` — a table the Studio renders and the admin baseline exposes over `/api/v1`. **Fix:** enqueue the webhook **id**; the handler reads the row through its plane-RPC and signs from there. The secret never enters the queue.

**Clauses:** a `nexus_webhook` row with a `file://` or `ftp://` URL is rejected at write; a receiver that never responds fails the job by timeout rather than hanging; the enqueued job payload contains no `secret` field.

## 9. I2, I3, I5 — cheap unauthenticated hardening

- **I2:** `start.js:91-102` reads request bodies with no size limit on the pre-auth `/_auth/verify` path. **Fix:** the same 1MB cap `api.js:23` already enforces, applied in the shared read helper both servers use.
- **I3:** the challenge Map grows on every unauthenticated `/_auth/challenge` and entries are deleted only on successful verify. **Fix:** sweep expired entries on insert, and cap the map (reject with `503`/`E_BUSY` past the cap rather than growing without bound).
- **I5:** production accepts a missing `token_secret` and silently generates an ephemeral one — every restart invalidates all sessions and two processes cannot verify each other's tokens. **Fix:** `mode === "production"` requires `token_secret`; missing is `E_NO_SECRET` at boot, in the same spirit as the existing `E_NO_AUTH` and `E_NO_TLS` refusals.

**Clauses:** an oversized pre-auth body is refused with the documented code; the challenge map does not exceed its cap under a flood; `nexus start` without `token_secret` refuses to boot.

## 10. Error handling

Every refusal added here is a **loud, coded error** (`E_AUTH`, `E_FORBIDDEN`, `E_NO_TRANSACTIONAL_DDL`, `E_NO_SECRET`, `E_BUSY`), never a silent skip. Two paths deliberately fail *closed* rather than erroring: an unknown-engine capability lookup throws rather than defaulting, and an undeclared `/_studio/*` route is admin-only rather than open.

## 11. Testing

All clauses are RED before their fix. Beyond the per-item clauses above, three **invariant** clauses guard against re-drift:

- **Every engine in `ENGINES` has a capability record** — adding an engine without declaring capabilities fails the suite.
- **Every `/_studio/*` route resolves to a declared role requirement** — adding a route without declaring one fails the suite (and behaves admin-only meanwhile).
- **No shipped baseline policy grants write on a permlevel-restricted field** — a general pin over `SYSTEM_BASELINES` so a future baseline cannot reopen C1's shape.

## Out of scope (recorded for the follow-up spec)

I6 (Threads.queues leak on job timeout), I7 (writes not atomic with embeddings/hooks), I8 (entity delete non-atomic, swallowed errors), I9 (`hotApply` without a transaction), I11 (remove-event id leak — already disclosed), backup streaming/memory, SQLite WAL + `busy_timeout`, rate limiting, SSE fan-out cost, TOCTOU on update/remove, and the `Test.js` runner hazard where an all-skipped run reports green. That last one is small and load-bearing — it belongs early in the follow-up.
