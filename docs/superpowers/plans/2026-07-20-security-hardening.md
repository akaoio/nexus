# Security Hardening v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close issue #9's Criticals and its security-class Importants, each clause-first, fixing boundaries by structure (declared capabilities, declared route requirements, permlevel) rather than by scattered conditionals.

**Architecture:** Three new declarative registries replace three classes of "you must remember": engine capabilities in `Data/adapters.js` (fail-closed on unknown engines), per-route role requirements in `dev.js` (admin-only default), and `permlevel` on the `roles` field so the permission engine itself — not a hook — stops self-escalation. Roles resolve per request from the live directory, so revocation is immediate and no token state exists to synchronize.

**Tech Stack:** Node ESM zero-dep kernel, repo conformance harness (`npm test`, explicit registration in `test.js`), real-process CLI and dev-server clauses.

**Spec:** `docs/superpowers/specs/2026-07-20-security-hardening-design.md` · **Issue:** #9

## Global Constraints

- Spec-first TDD (N6): every clause RED before its fix. Baseline: 540 green / 0 red / 53 skipped; stays 0 red.
- Permission v1 format is FROZEN (N4) — no new policy fields. `permlevel` and existing annotations only.
- Every refusal is a loud coded error: `E_AUTH`, `E_FORBIDDEN`, `E_NO_TRANSACTIONAL_DDL`, `E_NO_SECRET`, `E_BUSY`, `E_BODY_SIZE`.
- Fail-closed by construction: unknown engine → capability lookup throws; undeclared `/_studio/*` route → admin-only.
- Three invariant clauses are mandatory (Tasks 5, 6, 1): every `ENGINES` entry has capabilities; every `/_studio/*` route has a declared requirement; no shipped baseline grants write on a permlevel-restricted field.
- Commit style: repo sentence style; every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: C1 — `roles` behind permlevel 1

**Files:** Modify `src/core/App/system.js` · Test `test/app/system.test.js`

**Interfaces produced:** `nexus_user.roles` carries `permlevel: 1`; `SYSTEM_BASELINES` gains one admin policy `{ entity: "nexus_user", actions: ADMIN_ACTIONS, permlevel: 1, roles: ["admin"] }`.

- [ ] **Step 1: Clauses (RED)**

Append to `test/app/system.test.js`. Import `resolve, fields` from `../../src/core/Permission.js` if absent.

```js
    Test.it("SYS-10 self-service cannot touch roles: the field sits at permlevel 1, admin keeps it", () => {
        const user = SYSTEM_ENTITIES.find((s) => s.name === "nexus_user")
        const rolesField = user.fields.find((f) => f.name === "roles")
        assert.equal(rolesField.permlevel, 1) // the whole fix, in one assertion
        const schema = user
        const selfPolicies = SYSTEM_BASELINES.filter((p) => !p.roles) // what an ordinary user gets
        const selfCtx = { entity: "nexus_user", action: "write", user: "P", roles: [] }
        assert.equal(resolve(selfPolicies, selfCtx).allowed, true, "self-service still grants the row")
        assert.equal(fields(selfPolicies, selfCtx, schema).includes("roles"), false, "but never the roles field")
        assert.equal(fields(selfPolicies, selfCtx, schema).includes("name"), true, "ordinary fields still writable")
        const adminPolicies = SYSTEM_BASELINES.filter((p) => p.roles?.includes("admin"))
        const adminCtx = { entity: "nexus_user", action: "write", user: "A", roles: ["admin"] }
        assert.equal(fields(adminPolicies, adminCtx, schema).includes("roles"), true, "admin manages roles")
    })

    Test.it("SYS-11 INVARIANT: no shipped baseline grants write on a permlevel-restricted field to a roleless actor", () => {
        // pins C1's SHAPE, not just its instance — a future baseline cannot reopen it
        for (const schema of SYSTEM_ENTITIES) {
            const restricted = (schema.fields ?? []).filter((f) => (f.permlevel ?? 0) !== 0).map((f) => f.name)
            if (!restricted.length) continue
            const open = SYSTEM_BASELINES.filter((p) => !p.roles && p.entity === schema.name)
            const ctx = { entity: schema.name, action: "write", user: "P", roles: [] }
            const writable = fields(open, ctx, schema)
            for (const name of restricted)
                assert.equal(writable.includes(name), false, `${schema.name}.${name} must not be writable by a roleless baseline`)
        }
    })
```

- [ ] **Step 2: RED** — `npm test`: SYS-10 fails on `permlevel` undefined. Others green.
- [ ] **Step 3: Implement** — in `src/core/App/system.js`:

The `roles` field (~line 35) gains a permlevel and a comment stating why:

```js
        // permlevel 1: self-service (permlevel 0) must never write its own roles —
        // that path was a two-request escalation to admin (issue #9 C1)
        { name: "roles", type: "text", permlevel: 1, label: { en: "Roles", vi: "Vai trò" } }
```

In `SYSTEM_BASELINES`, immediately after the admin `.map(...)` entry, add the permlevel-1 companion (a permlevel-1 policy grants FIELD access only — document access still comes from the permlevel-0 admin policy above it):

```js
    // admin manages roles: field-level grant at permlevel 1 (document access
    // comes from the permlevel-0 admin bundle above)
    Object.freeze({ entity: "nexus_user", actions: ADMIN_ACTIONS, rule: null, permlevel: 1, ifOwner: false, roles: ["admin"] }),
```

- [ ] **Step 4: GREEN** — `npm test`: SYS-10/11 green; SYS-03/05/09 and every ROLE-*/user-page clause still green.
- [ ] **Step 5: Commit**

```bash
git add src/core/App/system.js test/app/system.test.js
git commit -m "C1: roles sits behind permlevel 1 — self-service can no longer promote itself (SYS-10/11)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: C1b — `/_auth/verify` refuses unknown identities

**Files:** Modify `src/cli/commands/start.js:119-130`, `src/cli/commands/dev.js:198-208` · Test `test/http/auth.test.js` (find the existing auth suite: `grep -ln "AUTH-" test/http/*.js`)

**Interfaces:** `authState` gains `knownPub(pub) → boolean` in `src/core/HTTP/server.js` beside `rolesForPub` (`server.js:250`) — `usersByPub.has(pub) || identities.some(i => i.pub === pub)`.

- [ ] **Step 1: Clause (RED)** — in the auth suite, on a real auth-on dev server (mirror how the file already boots one; if it has no live-server helper, copy the boot helper from `test/http/policy-window.test.js`):

```js
    Test.it("AUTH-STRANGER a keypair that is not provisioned gets no token, even with a valid signature", async () => {
        const pair = await generateKeyPair() // use whatever the suite already uses to make a ZEN identity
        const { nonce } = (await post("/api/v1/_auth/challenge", {})).body.data
        const signature = await sign(pair, nonce)
        const r = await post("/api/v1/_auth/verify", { pub: pair.pub, nonce, signature })
        assert.equal(r.status, 401)
        assert.equal(r.body.error.code, "E_AUTH")
        assert.equal(r.body.data?.token, undefined) // nothing minted
    })
```

Adapt the keypair/sign helpers to the suite's existing idiom — `src/core/App/auth.js` exports `verifyChallenge`; find how existing AUTH-* clauses build a signer and reuse it verbatim.

- [ ] **Step 2: RED** — a stranger currently receives 200 + token.
- [ ] **Step 3: Implement**

`src/core/HTTP/server.js`, beside `rolesForPub` (line ~250):

```js
        // membership: a token is for a PROVISIONED user — holding a keypair is
        // not membership (issue #9 C1b)
        authState.knownPub = (pub) => usersByPub.has(pub) || authState.identities.some((i) => i.pub === pub)
```

Also initialize it in the `authState` literal (`server.js:84`) as `knownPub: () => false` so the shape exists before the plane is built.

In BOTH `start.js` and `dev.js`, immediately after the `verifyChallenge` check and BEFORE `rolesForPub`/`issueToken`:

```js
            if (!authState.knownPub(b.pub))
                return json(res, 401, { ok: false, error: { code: "E_AUTH", message: "this identity is not provisioned on this instance" } })
```

- [ ] **Step 4: GREEN** — `npm test`; existing AUTH-* clauses that authenticate a *provisioned* identity must stay green (if any clause relied on an unprovisioned pub, that clause was asserting the bug — fix the clause and say so in the report).
- [ ] **Step 5: Commit**

```bash
git add src/core/HTTP/server.js src/cli/commands/start.js src/cli/commands/dev.js test/http/auth.test.js
git commit -m "C1b: verify refuses an unprovisioned pub — a keypair is not membership (AUTH-STRANGER)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: C2 — update/create return only permitted fields

**Files:** Modify `src/core/Data.js` (update ~262-279, create ~185-209) · Test `test/data/dataplane.test.js`

- [ ] **Step 1: Clause (RED)** — the suite already builds a plane; add a schema with a gated field:

```js
    Test.it("DPL-PERMLEVEL update and create never return a field the actor cannot read", async () => {
        const schema = { schemaVersion: 1, name: "staff", label: { en: "Staff" }, fields: [
            { name: "name", type: "text", label: { en: "N" } },
            { name: "salary", type: "integer", permlevel: 1, label: { en: "S" } }
        ] }
        // (build a plane over this schema the way this file already does, then:)
        const ADMIN = ctxWith([{ entity: "staff", actions: ["read","write","create"], permlevel: 0 },
                               { entity: "staff", actions: ["read","write","create"], permlevel: 1 }])
        const BASIC = ctxWith([{ entity: "staff", actions: ["read","write","create"], permlevel: 0 }])
        const row = await plane.create("staff", { name: "A", salary: 999 }, ADMIN)
        assert.equal(row.salary, 999)
        const madeBasic = await plane.create("staff", { name: "B" }, BASIC)
        assert.equal("salary" in madeBasic, false, "create must not echo a gated field")
        const patched = await plane.update("staff", row.id, { name: "A2" }, BASIC)
        assert.equal(patched.name, "A2")
        assert.equal("salary" in patched, false, "update must not leak the gated field")
        const asAdmin = await plane.update("staff", row.id, { name: "A3" }, ADMIN)
        assert.equal(asAdmin.salary, 999, "admin still sees it")
    })
```

Adapt `ctxWith` to the file's existing ctx-building idiom.

- [ ] **Step 2: RED** — `salary` is currently present in both responses.
- [ ] **Step 3: Implement** — in `src/core/Data.js`:

`update()` — select only permitted fields and shape the returned post-image to them:

```js
        const query = applyWhere(this.kysely.selectFrom(entity).select(fields), where, { dialect: this.dialect })
```

and after computing `post`, return a projection rather than the raw merge:

```js
        const visible = Object.fromEntries(Object.entries(post).filter(([k]) => fields.includes(k)))
        await this.#run(this.kysely.updateTable(entity).set(set).where("id", "=", id).compile())
        await this.#maintainEmbedding(entity, post)   // embedding still needs the FULL post-image
        if (this.hooks) await this.hooks.run("after:update", entity, { row: post }, ctx)
        return visible
```

Note for the implementer: `#maintainEmbedding` and the after-hook keep receiving the **full** `post` — only the value returned to the caller is projected. The post-image predicate check at `:271` also keeps using full `post`.

`create()` — same shape: project the returned row through `fields` while keeping the full row for embedding/hooks. Read `:194-209` and apply the identical treatment.

- [ ] **Step 4: GREEN** — `npm test`: DPL-PERMLEVEL green; every existing DPL-*/PERM-*/API-* clause green (many assert on returned rows — if one breaks because it asserted a gated field, that clause was asserting the leak; fix it and say so).
- [ ] **Step 5: Commit**

```bash
git add src/core/Data.js test/data/dataplane.test.js
git commit -m "C2: update and create return only the permitted field set (DPL-PERMLEVEL)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: C3 — backup is complete and redacted

**Files:** Modify `src/cli/commands/site.js` · Test `test/cli/ops.test.js` (the suite that already covers site backup — verify with `grep -ln "backup" test/cli/*.js`)

- [ ] **Step 1: Clause (RED)**

```js
    Test.it("SITE-BACKUP includes system entities and never writes a secret in cleartext", async () => {
        // scaffold an instance, seed a nexus_user + nexus_policy row via the CLI/API,
        // set token_secret + an api_key in nexus.config.json, then run `nexus site backup --json`
        const doc = JSON.parse(readFileSync(join(cwd, backupFile), "utf8"))
        assert.truthy(doc.data.nexus_user, "the directory is in the backup")
        assert.truthy(doc.data.nexus_policy, "the policy rows are in the backup")
        assert.equal(doc.config.token_secret, "***")
        assert.equal(doc.config.api_keys[0].key, "***")
        assert.equal(doc.secretsRedacted, true) // the restore path must know
    })
```

Build the instance the way the file's existing backup clause does; if none exists, mirror `test/http/models.test.js`'s real-process scaffolding.

- [ ] **Step 2: RED** — system entities absent, secrets in cleartext.
- [ ] **Step 3: Implement** — in `src/cli/commands/site.js`:

Import `SYSTEM_ENTITIES` from `../../core/App/system.js` and `redact` from `../../core/App/config.js`. Then:

```js
    // back up the SAME set the server composes — app schemas plus the system
    // entities, or a restore returns data nobody can log in to (issue #9 C3)
    const backupSchemas = [...schemas, ...SYSTEM_ENTITIES]
    const data = {}
    for (const schema of backupSchemas) {
        try { data[schema.name] = await executor.all(`SELECT * FROM ${quote(schema.name)}`) }
        catch { /* a system table absent on an old instance is not a failure */ }
    }
    const document = {
        backupVersion: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        config: redact(config),
        secretsRedacted: true, // restore must re-supply token_secret / api_keys
        apps: appFiles,
        data,
        migrations: await appliedMigrations(executor)
    }
```

Update the summary line to count `backupSchemas.length`. In the restore path (same file), when `secretsRedacted` is true print a loud hint that `token_secret` and API keys must be re-supplied before the instance can serve.

- [ ] **Step 4: GREEN** — `npm test`, 0 red.
- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/site.js test/cli/ops.test.js
git commit -m "C3: backup carries the system entities and redacts secrets (SITE-BACKUP)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: C4 — `/_studio/*` authorizes, admin-only by default

**Files:** Modify `src/cli/commands/dev.js` · Test `test/http/studio.test.js`

**Interfaces produced:** `STUDIO_ACCESS` — a frozen map of route path → required role or `"any"`; the gate consults it with an **admin-only default** for anything undeclared.

- [ ] **Step 1: Clauses (RED)** — the studio suite boots an authless dev server today; these clauses need an auth-ON instance (mirror `test/http/policy-window.test.js`'s two-key preamble: an `admin-key…` with roles `["admin"]` and a `viewer-key…` with roles `["viewer"]`, written into `nexus.config.json` before boot).

```js
    Test.it("STUDIO-08 a non-admin is refused every /_studio write and every state-exposing read", async () => {
        for (const [method, path, body] of [
            ["POST", "/_studio/model", { name: "sneaky", fields: [{ name: "x", type: "text" }] }],
            ["POST", "/_studio/config", { key: "token_secret", value: "stolen" }],
            ["GET", "/_studio/entities", undefined],
            ["GET", "/_studio/policies", undefined]
        ]) {
            const r = await callAs(VIEWER, method, path, body)
            assert.equal(r.status, 403, `${method} ${path}`)
            assert.equal(r.body.error.code, "E_FORBIDDEN")
        }
        assert.equal((await callAs(ADMIN, "GET", "/_studio/entities")).status, 200) // admin unaffected
    })

    Test.it("STUDIO-09 /_studio/session stays open to any authenticated user", async () => {
        assert.equal((await callAs(VIEWER, "GET", "/_studio/session")).status, 200)
    })

    Test.it("STUDIO-10 INVARIANT: every /_studio route has a declared access level; undeclared is admin-only", () => {
        // pins the fail-closed default so a new route cannot ship open by omission
        for (const path of STUDIO_ROUTE_PATHS) assert.truthy(STUDIO_ACCESS[path], `${path} must declare access`)
        assert.equal(STUDIO_ACCESS["/_studio/nonexistent"] ?? "admin", "admin")
    })
```

`STUDIO_ROUTE_PATHS` and `STUDIO_ACCESS` must be exported from dev.js (or a small sibling module) for STUDIO-10 to import. If exporting from dev.js is awkward (it is a long command module), create `src/cli/dev-access.js` holding both constants and import it from dev.js — that also gives the clause a clean import target.

- [ ] **Step 2: RED** — the viewer currently gets 200 everywhere.
- [ ] **Step 3: Implement**

Create `src/cli/dev-access.js`:

```js
/**
 * Who may call which /_studio route (issue #9 C4). The gate reads this table;
 * a route that is NOT listed is admin-only. Fail-closed by construction: a new
 * route ships strict unless someone deliberately opens it in this file.
 */

export const STUDIO_ACCESS = Object.freeze({
    "/_studio/session": "any",     // whoami — the login UI needs it before roles exist
    "/_studio/model": "admin",
    "/_studio/entities": "admin",
    "/_studio/entity-delete": "admin",
    "/_studio/policies": "admin",
    "/_studio/users": "admin",
    "/_studio/ai": "admin",
    "/_studio/config": "admin"
})

/** The declared route list, for the invariant clause. */
export const STUDIO_ROUTE_PATHS = Object.freeze(Object.keys(STUDIO_ACCESS))

/** Required role for a path — undeclared means admin. */
export const accessFor = (pathname) => STUDIO_ACCESS[pathname] ?? "admin"
```

In `dev.js`, replace the gate (~217-221) with:

```js
        if (url.pathname.startsWith("/_studio/") && studioAuthAtBoot) {
            const header = req.headers["authorization"] ?? ""
            const claims = header.startsWith("Bearer ") ? verifyToken(header.slice(7), authState.secret) : null
            if (!claims) return json(res, 401, { ok: false, error: { code: "E_AUTH", message: "sign in to use the Studio" } })
            // authorization, not just authentication (issue #9 C4): roles come
            // from the LIVE directory, never from the token's own claims
            const roles = authState.rolesForPub(claims.user) ?? []
            if (accessFor(url.pathname) === "admin" && !roles.includes("admin"))
                return json(res, 403, { ok: false, error: { code: "E_FORBIDDEN", message: "the Studio needs the admin role" } })
        }
```

Read the existing gate first and preserve whatever it already does (the `studioAuthAtBoot` condition and the exact `verifyToken` call shape) — change only the added authorization step. Import `accessFor` from `./dev-access.js`.

- [ ] **Step 4: GREEN** — `npm test`: the new clauses green; existing STUDIO-* clauses (authless instance → `studioAuthAtBoot` false → gate skipped) unaffected.
- [ ] **Step 5: Commit**

```bash
git add src/cli/dev-access.js src/cli/commands/dev.js test/http/studio.test.js
git commit -m "C4: /_studio authorizes by a declared table, admin-only by default (STUDIO-08/09/10)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: C5 — engine capabilities, declared

**Files:** Modify `src/core/Data/adapters.js`, `src/core/Data/migrate.js` · Test `test/data/adapters.test.js`, `test/conformance/model/` migration suite (find with `grep -ln "MIG-" test/**/*.js`)

**Interfaces produced:** `CAPABILITIES` (frozen, per engine), `capabilitiesFor(engine)` (throws `E_ENGINE` on unknown).

- [ ] **Step 1: Clauses (RED)**

In `test/data/adapters.test.js`:

```js
    Test.it("ADP-CAP every known engine declares capabilities; unknown engines throw", () => {
        for (const engine of ENGINES) {
            const caps = capabilitiesFor(engine)
            assert.equal(typeof caps.transactionalDDL, "boolean", `${engine} declares transactionalDDL`)
            assert.truthy(Object.isFrozen(caps))
        }
        assert.equal(capabilitiesFor("mysql").transactionalDDL, false) // the one that bites
        assert.equal(capabilitiesFor("sqlite").transactionalDDL, true)
        let threw = null
        try { capabilitiesFor("oracle") } catch (e) { threw = e }
        assert.truthy(String(threw?.message).startsWith("E_ENGINE"))
    })
```

In the migration suite:

```js
    Test.it("MIG-NOTX a non-transactional-DDL dialect refuses the structural path and runs NO DDL", async () => {
        const ran = []
        const executor = { run: async (sql) => { ran.push(sql); return { rows: [] } }, all: async () => [] }
        let threw = null
        try {
            await applyMigration({ executor, migration, dialect: "mysql", dryRun: true })
        } catch (e) { threw = e }
        assert.truthy(String(threw?.message).startsWith("E_NO_TRANSACTIONAL_DDL"))
        assert.equal(ran.length, 0, "not one statement may run — the old code DROPPED the table here")
    })
```

Build `migration` the way the existing MIG-* clauses do.

- [ ] **Step 2: RED** — `capabilitiesFor` missing; the mysql path currently executes DDL.
- [ ] **Step 3: Implement**

In `src/core/Data/adapters.js`, after `ENGINES`:

```js
/**
 * Engine capabilities (ARCHITECTURE.md §3 "Adapter: Kysely dialects +
 * capabilities", §4.6a's capability matrix) — declared, never assumed. The
 * migration engine asks instead of hardcoding dialect names, and an engine
 * added without a record fails closed rather than inheriting "yes".
 *
 * transactionalDDL: can DDL run inside a transaction and be rolled back?
 *   MySQL implicitly COMMITs on DDL, so its dry run would destroy the very
 *   table it was asked to measure (issue #9 C5).
 */
export const CAPABILITIES = Object.freeze({
    sqlite: Object.freeze({ transactionalDDL: true, vector: "sqlite-vec", fts: "fts5" }),
    turso: Object.freeze({ transactionalDDL: true, vector: "native", fts: "experimental" }),
    postgres: Object.freeze({ transactionalDDL: true, vector: "pgvector", fts: "tsvector" }),
    mysql: Object.freeze({ transactionalDDL: false, vector: "none", fts: "fulltext" })
})

/** Capabilities for an engine; unknown engines throw rather than defaulting. */
export function capabilitiesFor(engine) {
    const caps = CAPABILITIES[engine]
    if (!caps) throw err("E_ENGINE", `unknown engine "${engine}" (known: ${ENGINES.join(", ")})`)
    return caps
}
```

Add both to the default export. (`err` already exists in this file — check its name and reuse it.)

In `src/core/Data/migrate.js` `applyMigration`, immediately after `checkInputs` and BEFORE any statement runs:

```js
    // Capability, not a special case: an engine whose DDL cannot roll back must
    // never enter this path — its "dry run" would be a real, irreversible drop.
    if (!capabilitiesFor(engineOf(dialect)).transactionalDDL)
        throw err("E_NO_TRANSACTIONAL_DDL", `dialect "${dialect}" commits DDL implicitly — structural migration (and its dry run) cannot be rolled back. Take a backup and apply the migration with the engine's own tooling.`)
```

Note: `dialect` and `engine` are 1:1 today (`engineDialect = (engine) => engine`, adapters.js:39), so `engineOf` can simply be the identity — but write it as a named helper with a comment so the day they diverge is a compile-time question, not a silent bug. Import `capabilitiesFor` from `./adapters.js`, and update the header comment at `migrate.js:20` that currently claims "on every engine alike".

- [ ] **Step 4: GREEN** — `npm test`: ADP-CAP + MIG-NOTX green; every existing MIG-*/DDL-* clause (sqlite dialect) green.
- [ ] **Step 5: Commit**

```bash
git add src/core/Data/adapters.js src/core/Data/migrate.js test/data/adapters.test.js test/conformance
git commit -m "C5: engine capabilities are declared — non-transactional DDL refuses the structural path (ADP-CAP, MIG-NOTX)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: I4 — roles resolve per request

**Files:** Modify `src/core/HTTP/server.js:278-298` · Test `test/http/policy-window.test.js` (auth-on instance already there) or a new `test/http/revocation.test.js` registered in `test.js`

- [ ] **Step 1: Clause (RED)** — on an auth-on instance with an admin identity in `nexus_user`:

```js
    Test.it("AUTH-REVOKE clearing a user's roles takes effect immediately, without re-issuing the token", async () => {
        const token = await signInAs(adminPair)            // token minted while admin
        assert.equal((await withToken(token, "POST", "/api/v1/nexus_role", { name: "probe" })).body.ok, true)
        await callAs(ROOT_KEY, "PATCH", `/api/v1/nexus_user/${adminRowId}`, { roles: JSON.stringify([]) })
        const after = await withToken(token, "POST", "/api/v1/nexus_role", { name: "probe2" })
        assert.equal(after.body.ok, false)                  // same token, no longer admin
        assert.equal(after.body.error.code, "E_FORBIDDEN")
    })
```

(The PATCH is performed by an admin API key, since after Task 1 only admins may write `roles`.)

- [ ] **Step 2: RED** — the old token keeps admin for its full TTL.
- [ ] **Step 3: Implement** — in `context()`:

```js
            if (bearer) {
                const claims = verifyToken(bearer, authState.secret)
                // The token proves IDENTITY; roles come from the LIVE directory
                // every request, so revocation is immediate and no token state
                // needs synchronizing (issue #9 I4). claims.roles stays in the
                // payload for debugging and is never trusted here.
                if (claims) {
                    const roles = authState.rolesForPub(claims.user) ?? []
                    return { user: claims.user, roles, policies: policiesFor(livePolicies(), roles), shares: [] }
                }
            }
```

- [ ] **Step 4: GREEN** — `npm test`, 0 red.
- [ ] **Step 5: Commit**

```bash
git add src/core/HTTP/server.js test/http/revocation.test.js test.js
git commit -m "I4: the token proves identity, the directory decides roles — revocation is immediate (AUTH-REVOKE)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: I1 + I10 — webhook hardening

**Files:** Modify `src/core/App/effects.js`, `src/core/HTTP/server.js` (validation hook registration) · Test `test/app/effects.test.js`, `test/http/jobs-live.test.js`

- [ ] **Step 1: Clauses (RED)**

Pure, in `test/app/effects.test.js`:

```js
    Test.it("WH-04 validateWebhookRow: only http(s) URLs are accepted", () => {
        assert.equal(validateWebhookRow({ url: "https://ok.example/hook" }).valid, true)
        assert.equal(validateWebhookRow({ url: "http://ok.example/hook" }).valid, true)
        assert.equal(validateWebhookRow({ url: "file:///etc/passwd" }).valid, false)
        assert.equal(validateWebhookRow({ url: "ftp://x/y" }).valid, false)
        assert.equal(validateWebhookRow({ url: "not a url" }).valid, false)
    })
```

Live, in `test/http/jobs-live.test.js`:

```js
    Test.it("WH-05 a file:// webhook row is refused at write; the enqueued payload carries no secret", async () => {
        const bad = await post("/api/v1/nexus_webhook", { url: "file:///etc/passwd", entity: "task", events: JSON.stringify(["after:create"]), secret: "s", enabled: true })
        assert.equal(bad.body.ok, false)
        assert.equal(bad.body.error.code, "E_INVALID")
        const good = await post("/api/v1/nexus_webhook", { url: "http://127.0.0.1:9/never", entity: "task", events: JSON.stringify(["after:create"]), secret: "s3cret", enabled: true })
        assert.equal(good.body.ok, true)
        await post("/api/v1/task", { title: "fire" })
        let jobs = []
        for (let i = 0; i < 30 && !jobs.length; i++) {
            await new Promise((r) => setTimeout(r, 500))
            jobs = (await post("/api/v1/nexus_job/query", { filter: null, limit: 20 })).body.data.filter((j) => j.name === "effects.webhook")
        }
        assert.truthy(jobs.length)
        const payload = JSON.parse(jobs[0].payload)
        assert.equal("secret" in payload, false, "the signing secret must never enter the ledger")
        assert.truthy(payload.webhookId)
    })
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — in `src/core/App/effects.js`:

Export the validator and use it both at write time and dispatch time:

```js
/** A webhook row must target http(s) — anything else is an SSRF vector (issue #9 I1). */
export function validateWebhookRow(data = {}) {
    let parsed
    try { parsed = new URL(String(data.url ?? "")) } catch { return { valid: false, errors: [{ code: "E_URL" }] } }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { valid: false, errors: [{ code: "E_SCHEME" }] }
    return { valid: true }
}
```

The emitter enqueues the **id**, never the secret:

```js
            await registrar.enqueue("effects.webhook", { webhookId: row.id, body: { entity, event, id, ts: Date.now() } })
```

The handler resolves the row through its plane-RPC, re-validates, and fetches with a timeout and no redirects:

```js
    registrar.job("effects.webhook", {
        run: async ({ id, payload }, { plane: rpc }) => {
            const row = await rpc.get("nexus_webhook", payload.webhookId)
            if (!row) throw new Error("E_WEBHOOK: subscription is gone")
            if (!validateWebhookRow(row).valid) throw new Error("E_WEBHOOK: subscription URL is not http(s)")
            const res = await fetch(row.url, {
                method: "POST",
                redirect: "manual", // a redirect is a failure, not a silent hop
                signal: AbortSignal.timeout(config.webhooks?.timeout_ms ?? 10000),
                headers: {
                    "content-type": "application/json",
                    "x-nexus-signature": sign(row.secret, payload.body),
                    "x-nexus-delivery": String(id)
                },
                body: JSON.stringify(payload.body)
            })
            if (!res.ok) throw new Error(`E_WEBHOOK: receiver answered ${res.status}`)
            return { status: res.status }
        }
    })
```

JOB_CTX must be able to read `nexus_webhook` — it already grants `read` (`server.js` JOB_CTX). Verify before relying on it.

In `src/core/HTTP/server.js`, register the write-time veto beside the existing `nexus_policy` hooks:

```js
        for (const event of ["before:create", "before:update"])
            extensions.hook("nexus_webhook", event, (payload) => {
                const data = payload.data ?? payload.patch ?? {}
                if (data.url === undefined) return
                const result = validateWebhookRow(data)
                if (!result.valid) throw new Error("E_INVALID: " + JSON.stringify(result.errors))
            })
```

- [ ] **Step 4: GREEN** — `npm test`: WH-01/02/03 still green (WH-02's receiver assertions must survive the payload change — update them if they read `payload.secret`).
- [ ] **Step 5: Commit**

```bash
git add src/core/App/effects.js src/core/HTTP/server.js test/app/effects.test.js test/http/jobs-live.test.js
git commit -m "I1/I10: webhooks are http(s)-only with a timeout, and the signing secret never enters the ledger (WH-04/05)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: I2 + I3 + I5 — unauthenticated hardening

**Files:** Modify `src/cli/commands/start.js`, `src/cli/commands/dev.js`, `src/core/HTTP/server.js` · Test `test/http/start.test.js`

- [ ] **Step 1: Clauses (RED)**

```js
    Test.it("START-SECRET production refuses to boot without token_secret", () => {
        // instance with api_keys but no token_secret, spawnSync `nexus start --insecure`
        assert.equal(r.status !== 0, true)
        assert.truthy((r.stdout + r.stderr).includes("E_NO_SECRET"))
    })

    Test.it("START-BODY the pre-auth verify endpoint refuses an oversized body", async () => {
        const huge = "x".repeat(2 * 1024 * 1024)
        const r = await post("/api/v1/_auth/verify", { pub: huge })
        assert.equal(r.status, 413)
        assert.equal(r.body.error.code, "E_BODY_SIZE")
    })

    Test.it("START-CHALLENGE the challenge map is capped and sweeps expiries", async () => {
        for (let i = 0; i < 1100; i++) await post("/api/v1/_auth/challenge", {})
        const r = await post("/api/v1/_auth/challenge", {})
        assert.equal([200, 503].includes(r.status), true)
        if (r.status === 503) assert.equal(r.body.error.code, "E_BUSY")
    })
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement**

`start.js` body reader — cap at 1MB like `api.js:23`:

```js
const BODY_LIMIT = 1024 * 1024
const readJson = (req) => new Promise((resolve) => {
    let raw = ""
    let size = 0
    req.on("data", (c) => {
        size += c.length
        if (size > BODY_LIMIT) { req.destroy(); resolve(Symbol.for("E_BODY_SIZE")) }   // sentinel, not a hang
        else raw += c
    })
    req.on("end", () => { try { resolve(JSON.parse(raw || "{}")) } catch { resolve(null) } })
    req.on("error", () => resolve(null))
})
```

and at each call site, `if (b === Symbol.for("E_BODY_SIZE")) return json(res, 413, { ok: false, error: { code: "E_BODY_SIZE" } })`. **Note:** `dev.js:135-138` has the same bug in a worse form (it destroys the request and never resolves, hanging the connection) — fix it the same way while here.

Challenge map, both servers — sweep on insert and cap:

```js
const CHALLENGE_CAP = 1000
// sweep expiries first so a steady flood cannot pin the cap forever
for (const [n, exp] of challenges) if (exp < Date.now()) challenges.delete(n)
if (challenges.size >= CHALLENGE_CAP)
    return json(res, 503, { ok: false, error: { code: "E_BUSY", message: "too many pending challenges" } })
```

Production requires a token secret — in `server.js` beside the existing `E_NO_AUTH` refusal (`:262`):

```js
        if (mode === "production" && !config.token_secret)
            throw Object.assign(new Error("E_NO_SECRET: production requires token_secret in nexus.config.json — an ephemeral secret invalidates every session on restart and cannot be shared across processes"), { code: "E_NO_SECRET" })
```

- [ ] **Step 4: GREEN** — `npm test`: existing START-* clauses must still pass; any that boot production without `token_secret` need one added (they were relying on the ephemeral fallback).
- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/start.js src/cli/commands/dev.js src/core/HTTP/server.js test/http/start.test.js
git commit -m "I2/I3/I5: body caps, swept and capped challenges, and production demands a real token_secret (START-BODY/CHALLENGE/SECRET)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: STATUS + issue closure sweep

**Files:** Modify `STATUS.md`

- [ ] **Step 1: STATUS edits**
- Add a **Security hardening** row to the Implemented table listing what shipped: permlevel on `roles`, provisioned-identity requirement, field projection on write responses, complete+redacted backup, `/_studio` authorization table, engine capability registry, per-request role resolution, webhook scheme+timeout+secret handling, body caps and challenge caps, production `token_secret` requirement — clauses `SYS-10/11, AUTH-STRANGER/REVOKE, DPL-PERMLEVEL, SITE-BACKUP, STUDIO-08/09/10, ADP-CAP, MIG-NOTX, WH-04/05, START-BODY/CHALLENGE/SECRET`.
- In the drift/unfinished list, DELETE any bullet these fixes falsify, and ADD honest bullets for what remains open from issue #9: the deferred correctness items (I6-I9, I11), backup streaming/memory, SQLite WAL + `busy_timeout`, rate limiting, TOCTOU on update/remove, and the `Test.js` all-skipped-reports-green hazard.
- State plainly that issue #9's Criticals are closed and the follow-up spec covers the rest.

- [ ] **Step 2: Full suite + real-flow** — `npm test`; expected baseline 540 plus ~15 new clauses, 0 red. Then the escalation probe by hand on a scratch auth-on instance: provision a non-admin user, attempt `PATCH /api/v1/nexus_user/<own id>` with `{"roles":"[\"admin\"]"}`, confirm the response no longer contains `roles` and the directory still shows the original roles.
- [ ] **Step 3: Commit**

```bash
git add STATUS.md
git commit -m "STATUS: the audit criticals are closed — what shipped, and what is honestly still open

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
