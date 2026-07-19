# Permissions Editor on nexus_policy Rows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Studio permissions editor reads every policy layer through one read-only window built from the engine's runtime arrays and writes only through the Data Plane (`nexus_policy` rows); the bespoke `/_studio/permissions` write path dies.

**Architecture:** Composition stays a purely additive union of four layers (`appPolicies ∪ SYSTEM_BASELINES ∪ adminBaselines ∪ dbPolicies`), pinned by a conformance clause. `loadPolicies` stamps each app policy with its source file; `buildInstanceApi` exposes `policyLayers()`; dev.js serves `GET /_studio/policies` from it. Rows are defended on write (`validatePolicyRow` veto hooks) and tolerated on read (`unpackPolicyRows` skips corrupt rows). The page diffs its edits into ordinary entity-API row writes.

**Tech Stack:** Node ESM, zero-dependency kernel, repo conformance harness (`src/core/Test.js`, `npm test`), real-process dev-server tests.

**Spec:** `docs/superpowers/specs/2026-07-19-permissions-editor-rows-design.md`

## Global Constraints

- Spec-first TDD (N6): every behavior lands as a RED clause first. New clause ids: `PERM-U01`, `SYS-06..08`, `STUDIO-04` (replaced), `STUDIO-06/07`, `POLWIN-01/02`.
- Composition is a purely additive union — no layer revokes/shadows another (spec §1). Nothing in this plan may special-case one layer inside `resolve`/`policiesFor`.
- The ONLY policy write path is `/api/v1/nexus_policy` (spec §3). No new write endpoint anywhere; `GET`/`POST /_studio/permissions` must 404 (spec §5).
- `source`/`id` are pass-through annotation keys on policy objects — `validatePolicy` ignores unknown keys, `packPolicy` strips them; never make the engine read them.
- `src/core/App/policies.js` and `src/core/App/system.js` must stay browser-loadable (no top-level `fs`/`path` imports — see policies.js header).
- No migration machinery; `studio.json` keeps zero special status (it is just another `permissions/*.json` if present).
- Commit style: repo sentence style, each commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Suite: `npm test` — every existing clause stays green, 0 red. Baseline before this plan: 489 green / 53 skipped.

---

### Task 1: The composition contract + source stamps

**Files:**
- Modify: `src/core/App/policies.js:61-81` (`loadPolicies`)
- Modify: `src/cli/commands/dev.js:233` (preserve real source stamps in the delete-plan input)
- Test: `test/conformance/permission/resolve.test.js`, `test/app/system.test.js`

**Interfaces:**
- Produces: every policy loaded by `loadPolicies` carries `source: "app:apps/<dir>/permissions/<file>.json"`. Task 3's window groups the app layer by this key.

- [ ] **Step 1: Write the two clauses**

In `test/conformance/permission/resolve.test.js`, append inside the existing `Test.describe` (uses the already-imported `Permission`; probe contexts are plain objects, the style of `test/app/system.test.js:59`):

```js
    Test.it("PERM-U01 composition is a purely ADDITIVE union — a layered set grants iff some layer grants", () => {
        // the hundred-year contract (spec 2026-07-19 §1): layers OR together, never interact
        const a = { entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }
        const b = { entity: "task", actions: ["create"], rule: null, permlevel: 0, ifOwner: false, roles: ["editor"] }
        const probes = [
            { entity: "task", action: "read", user: "u", roles: [] },
            { entity: "task", action: "create", user: "u", roles: [] },
            { entity: "task", action: "delete", user: "u", roles: [] },
            { entity: "invoice", action: "read", user: "u", roles: [] }
        ]
        for (const [A, B] of [[[a], [b]], [[a, b], []], [[], []], [[a], [a]]]) {
            for (const probe of probes) {
                const union = Permission.resolve([...A, ...B], probe).allowed
                const or = Permission.resolve(A, probe).allowed || Permission.resolve(B, probe).allowed
                assert.equal(union, or, JSON.stringify({ A, B, probe }))
            }
        }
    })
```

Note: this clause PINS existing semantics — it is expected to pass immediately (a contract lock, like MODEL-01). The RED discipline applies to the next clause.

In `test/app/system.test.js`, append inside the describe. Extend the file's imports with `loadPolicies` from `../../src/core/App/policies.js` and `{ mkdtempSync, mkdirSync, writeFileSync, rmSync }` from `fs`, `{ tmpdir }` from `os`, `{ join }` from `path` (add only the ones not already imported):

```js
    Test.it("SYS-08 loadPolicies stamps each policy with its source file (app:<path>) — labels ride the engine's own objects", () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-polsrc-"))
        mkdirSync(join(scratch, "apps", "crm", "permissions"), { recursive: true })
        writeFileSync(join(scratch, "apps", "crm", "permissions", "team.json"),
            JSON.stringify([{ entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }]))
        const loaded = loadPolicies(scratch, [{ dir: "crm" }], null)
        assert.equal(loaded.length, 1)
        assert.equal(loaded[0].source, "app:apps/crm/permissions/team.json")
        assert.equal(loaded[0].entity, "task") // the policy itself is intact
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
```

- [ ] **Step 2: Run to verify**

Run: `npm test`
Expected: PERM-U01 green (pin). SYS-08 RED — `source` is `undefined`.

- [ ] **Step 3: Implement the stamp**

In `src/core/App/policies.js` `loadPolicies`, the push line (currently `policies.push(policy)`) becomes:

```js
                policies.push({ ...policy, source: `app:${file}` })
```

(`file` is already the repo-relative `apps/<dir>/permissions/<entry>` string used in the error messages.)

In `src/cli/commands/dev.js:233`, the delete-plan input currently clobbers the stamp; flip the spread so a real stamp survives:

```js
                    baselinePolicies: appPolicies.map((p) => ({ source: "app", ...p })),
```

- [ ] **Step 4: Run to verify GREEN**

Run: `npm test`
Expected: SYS-08 green; every existing clause (notably PERM-*, LIFE-*, the delete-plan clauses) still green — `source` is annotation, nothing reads it yet.

- [ ] **Step 5: Commit**

```bash
git add src/core/App/policies.js src/cli/commands/dev.js test/conformance/permission/resolve.test.js test/app/system.test.js
git commit -m "Policies: the additive-union contract is PINNED (PERM-U01); loadPolicies stamps source files (SYS-08)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Row defenses — validate on write, tolerate on read

**Files:**
- Modify: `src/core/App/system.js` (add `validatePolicyRow`, `unpackPolicyRows`)
- Modify: `src/core/HTTP/server.js:189-212` (veto hooks + tolerant `refreshPolicies` with row ids)
- Test: `test/app/system.test.js`

**Interfaces:**
- Consumes: `validatePolicy(policy, schemas)` from `App/policies.js`, existing `packPolicy`/`unpackPolicy`.
- Produces: `validatePolicyRow(data, schemas) → { valid } | { valid: false, errors }`; `unpackPolicyRows(rows) → { policies: [{ id, …policy }], skipped: [{ id, error }] }`. Task 3 relies on `dbPolicies` entries carrying `id`.

- [ ] **Step 1: Write the failing clauses**

In `test/app/system.test.js`, extend the system.js import with `validatePolicyRow, unpackPolicyRows` and append:

```js
    Test.it("SYS-06 validatePolicyRow: a nexus_policy row's data must unpack into a VALID policy — same law for every writer", () => {
        const good = packPolicy({ entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: false })
        assert.equal(validatePolicyRow(good).valid, true)
        assert.equal(validatePolicyRow({ ...good, actions: JSON.stringify(["fly"]) }).valid, false) // unknown action
        assert.equal(validatePolicyRow({ ...good, actions: "{not json" }).valid, false) // unparseable → E_POLICY
        assert.equal(validatePolicyRow({ ...good, permlevel: 99 }).valid, false)
        assert.equal(validatePolicyRow({ ...good, rule: JSON.stringify({ op: "nonsense" }) }).valid, false) // broken AST
        const schemas = [{ name: "task", fields: [] }]
        assert.equal(validatePolicyRow({ ...good, entity: "ghost" }, schemas).valid, false)
        assert.equal(validatePolicyRow(good, schemas).valid, true)
    })

    Test.it("SYS-07 unpackPolicyRows tolerates corrupt rows — skips and reports, NEVER throws (one bad row must not kill auth)", () => {
        const good = { id: "r1", ...packPolicy({ entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }) }
        const bad = { id: "r2", entity: "task", actions: "{not json", rule: null, permlevel: 0, ifowner: 0 }
        const { policies, skipped } = unpackPolicyRows([good, bad])
        assert.equal(policies.length, 1)
        assert.equal(policies[0].id, "r1") // the row id rides the unpacked policy
        assert.equal(policies[0].entity, "task")
        assert.equal(skipped.length, 1)
        assert.equal(skipped[0].id, "r2")
        assert.truthy(skipped[0].error)
        assert.deepEqual(unpackPolicyRows(null), { policies: [], skipped: [] })
    })
```

- [ ] **Step 2: Run to verify RED**

Run: `npm test`
Expected: SYS-06/07 RED (imports fail — functions don't exist). Others green.

- [ ] **Step 3: Implement the helpers**

In `src/core/App/system.js`, add at the top (keeps the file browser-loadable — policies.js is browser-safe by contract):

```js
import { validatePolicy } from "./policies.js"
```

Below `unpackPolicy`, add:

```js
/**
 * Validate a nexus_policy ROW's data columns as the policy it will become.
 * The write-side defense (design 2026-07-19 §3): the same law binds the
 * Studio and any direct API caller. Unparseable JSON columns are E_POLICY.
 */
export function validatePolicyRow(data, schemas = null) {
    let policy
    try {
        policy = unpackPolicy(data)
    } catch {
        return { valid: false, errors: [{ code: "E_POLICY" }] }
    }
    return validatePolicy(policy, schemas)
}

/**
 * Unpack nexus_policy rows TOLERANTLY (design §3 read-side defense): a
 * corrupt row is collected, never thrown — one bad row must never take
 * down the auth layer. Each unpacked policy carries its row id.
 */
export function unpackPolicyRows(rows) {
    const policies = []
    const skipped = []
    for (const row of rows ?? []) {
        try {
            policies.push({ id: row.id, ...unpackPolicy(row) })
        } catch (error) {
            skipped.push({ id: row?.id, error: String(error?.message ?? error) })
        }
    }
    return { policies, skipped }
}
```

Add both to the file's default export object.

- [ ] **Step 4: Wire the server**

In `src/core/HTTP/server.js:16`, extend the system.js import with `validatePolicyRow, unpackPolicyRows` (drop `unpackPolicy` from the import — it becomes unused here after this step).

Replace `refreshPolicies` (lines 199-203):

```js
        const refreshPolicies = async () => {
            const rows = await plane.list("nexus_policy", {}, NEXUS_CTX)
            const { policies, skipped } = unpackPolicyRows(rows)
            dbPolicies.length = 0
            dbPolicies.push(...policies)
            for (const bad of skipped)
                console.warn(`nexus_policy row ${bad.id} skipped (${bad.error}) — repair or delete it via /api/v1/nexus_policy`)
        }
```

Directly after the existing `for (const event of [...])` hook-registration loop (line 212), register the veto hooks:

```js
        // write-side defense: a nexus_policy row must BE a valid policy —
        // before-hooks THROW to veto (App API contract), so an invalid row
        // never reaches the table, from the Studio or any API caller
        extensions.hook("nexus_policy", "before:create", (payload) => {
            const result = validatePolicyRow(payload.data, allSchemas)
            if (!result.valid) throw new Error("E_INVALID: " + JSON.stringify(result.errors))
        })
        extensions.hook("nexus_policy", "before:update", async (payload) => {
            const rows = await plane.list("nexus_policy", {}, NEXUS_CTX)
            const current = rows.find((r) => r.id === payload.id) ?? {}
            const result = validatePolicyRow({ ...current, ...payload.patch }, allSchemas)
            if (!result.valid) throw new Error("E_INVALID: " + JSON.stringify(result.errors))
        })
```

(`allSchemas` is the schemas variable already in scope for `devPolicies(allSchemas)`/`adminBaselines(allSchemas)` — if the local name differs at this point in the function, use the same variable those calls use.)

- [ ] **Step 5: Run to verify GREEN**

Run: `npm test`
Expected: SYS-06/07 green. Existing SYS-*/ROLE-*/LIFE-* clauses that create valid `nexus_policy` rows stay green (they write valid policies; the veto only bites invalid ones). 0 red.

**Documented deviation from spec §7 (reviewer: judge, don't silently accept):** the spec sketches the read-tolerance test as a live raw-executor corruption + server boot. This plan pins tolerance at the pure seam instead (SYS-07) because the boot path's only involvement is the one-line `refreshPolicies` call into `unpackPolicyRows` (reviewed in this task), while a live raw-DB write would couple the suite to the engine's file layout and `node:sqlite` availability. If the reviewer or the human disagrees, a live clause goes into `test/http/policy-window.test.js` as a follow-up.

- [ ] **Step 6: Commit**

```bash
git add src/core/App/system.js src/core/HTTP/server.js test/app/system.test.js
git commit -m "nexus_policy defenses: validatePolicyRow veto on write, unpackPolicyRows tolerance on read (SYS-06/07)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: The read window + the death of /_studio/permissions

**Files:**
- Modify: `src/core/HTTP/server.js:274` (return `policyLayers`)
- Modify: `src/cli/commands/dev.js` (destructure `policyLayers` at lines 75 and 91; add `GET /_studio/policies`; DELETE the `/_studio/permissions` GET+POST handlers at lines 260-285; ensure unmatched `/_studio/*` 404s)
- Test: `test/http/studio.test.js` (replace STUDIO-04; add STUDIO-06/07), Create: `test/http/policy-window.test.js` (POLWIN-*)

**Interfaces:**
- Consumes: `dbPolicies` entries with `id` (Task 2), `source` stamps (Task 1).
- Produces: `buildInstanceApi` return gains `policyLayers: () => ({ app, system, admin, rows })` (live array references). `GET /_studio/policies` → `{ ok, data: { layers: [{ source, readonly, policies }], devMode, authRequired } }` with app layer grouped per source file, then `system`, `admin`, `rows` (readonly: false). Task 4's page consumes exactly this.

- [ ] **Step 1: Write the failing clauses**

In `test/http/studio.test.js`: REPLACE the body of STUDIO-04 (the old clause pins the endpoint that dies — its assertion inverts):

```js
    Test.it("STUDIO-04 the bespoke permissions write path is DEAD — /_studio/permissions 404s both ways", async () => {
        const g = await fetch((await ensure()) + "/_studio/permissions")
        assert.equal(g.status, 404)
        const p = await post("/_studio/permissions", { policies: [] })
        assert.equal(p.status, 404)
    })
```

Append (note: the instance is authless — the DEV context is wide-open, but plane hooks run regardless):

```js
    Test.it("STUDIO-06 GET /_studio/policies is the engine's own layers; a row created via the plane appears under rows", async () => {
        const created = await post("/api/v1/nexus_policy", {
            entity: "task", actions: JSON.stringify(["read"]), rule: null,
            permlevel: 0, ifowner: false, roles: JSON.stringify(["viewer"])
        })
        assert.equal(created.body.ok, true)
        const id = created.body.data.id
        const w = await fetch((await ensure()) + "/_studio/policies").then((r) => r.json())
        assert.equal(w.ok, true)
        const sources = w.data.layers.map((l) => l.source)
        assert.truthy(sources.includes("system") && sources.includes("admin") && sources.includes("rows"))
        const rows = w.data.layers.find((l) => l.source === "rows")
        assert.equal(rows.readonly, false)
        assert.truthy(rows.policies.some((p) => p.id === id && p.entity === "task"))
        for (const layer of w.data.layers) if (layer.source !== "rows") assert.equal(layer.readonly, true)
        assert.equal(typeof w.data.devMode, "boolean")
    })

    Test.it("STUDIO-07 an invalid nexus_policy row is VETOED at the plane — same law for every writer", async () => {
        const bad = await post("/api/v1/nexus_policy", { entity: "task", actions: JSON.stringify(["fly"]), rule: null, permlevel: 0, ifowner: false })
        assert.equal(bad.body.ok, false)
        assert.equal(bad.body.error.code, "E_INVALID")
        const broken = await post("/api/v1/nexus_policy", { entity: "task", actions: "{not json", rule: null, permlevel: 0, ifowner: false })
        assert.equal(broken.body.ok, false)
    })
```

If the create-response id lives elsewhere than `body.data.id`, mirror the create clause in `test/http/api.test.js` — that file is the contract for `/api/v1` response shapes.

Create `test/http/policy-window.test.js` — the enforcement probe on a REAL auth-on instance (API keys, both roles):

```js
/**
 * Policy window ≡ engine (POLWIN-*) — design 2026-07-19 §7. A real dev
 * server with auth ON (two API keys): a grant that exists only in an app
 * FILE and one that exists only in ROWS are both enforced through
 * /api/v1 — and the row grant goes live with NO restart (hook refresh).
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

const scratch = mkdtempSync(join(tmpdir(), "nexus-polwin-"))
spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
const instance = join(scratch, "shop")
// auth ON from boot: two API keys; a FILE baseline grants viewer read on task
const cfgPath = join(instance, "nexus.config.json")
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"))
cfg.api_keys = [
    { key: "admin-key-0123456789abcdef", user: "root", roles: ["admin"] },
    { key: "viewer-key-0123456789abcde", user: "eye", roles: ["viewer"] }
]
writeFileSync(cfgPath, JSON.stringify(cfg, null, 4))
mkdirSync(join(instance, "apps", "starter", "permissions"), { recursive: true })
writeFileSync(join(instance, "apps", "starter", "permissions", "base.json"),
    JSON.stringify([{ entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: false, roles: ["viewer"] }]))

let server = null
let base = null
async function ensure() {
    if (base) return base
    server = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: instance })
    base = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev did not start")), 8000)
        let buf = ""
        server.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
        server.on("exit", () => reject(new Error("dev exited early")))
    })
    return base
}
const call = async (key, method, path, body) => {
    const r = await fetch((await ensure()) + path, {
        method,
        headers: { "content-type": "application/json", "x-nexus-key": key },
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: r.status, body: await r.json() }
}
const ADMIN = "admin-key-0123456789abcdef"
const VIEWER = "viewer-key-0123456789abcde"

Test.describe("Policy window ≡ engine (POLWIN)", () => {
    Test.it("POLWIN-01 a FILE-layer grant is enforced; everything ungranted stays denied (deny-by-default)", async () => {
        const read = await call(VIEWER, "POST", "/api/v1/task/query", { filter: null, limit: 10 })
        assert.equal(read.body.ok, true) // base.json grants viewer read
        const create = await call(VIEWER, "POST", "/api/v1/task", { title: "nope" })
        assert.equal(create.body.ok, false) // nothing grants viewer create
    })

    Test.it("POLWIN-02 a ROWS-layer grant goes live with NO restart and composes additively with the file layer", async () => {
        const grant = await call(ADMIN, "POST", "/api/v1/nexus_policy", {
            entity: "task", actions: JSON.stringify(["create"]), rule: null,
            permlevel: 0, ifowner: false, roles: JSON.stringify(["viewer"])
        })
        assert.equal(grant.body.ok, true)
        const create = await call(VIEWER, "POST", "/api/v1/task", { title: "granted by a row" })
        assert.equal(create.body.ok, true) // hot: hook-refresh, no restart
        const read = await call(VIEWER, "POST", "/api/v1/task/query", { filter: null, limit: 10 })
        assert.equal(read.body.ok, true) // the file grant still holds — additive union
        const del = await call(VIEWER, "DELETE", "/api/v1/task/" + create.body.data.id)
        assert.equal(del.body.ok, false) // still nothing grants delete
    })
})

Test.after?.(() => { try { server?.kill("SIGKILL") } catch {} try { rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch {} })
```

If the harness has no `Test.after`, mirror how `test/http/studio.test.js` cleans up its server (check its bottom; if it leaks intentionally under the runner's process-exit, do the same and drop the after-block).

- [ ] **Step 2: Run to verify RED**

Run: `npm test`
Expected: STUDIO-04 RED (old endpoint still answers 200), STUDIO-06 RED (`/_studio/policies` unknown), STUDIO-07 RED (no veto hook error code yet if Task 2 landed the hook this passes — then it is a pin, note it in the commit), POLWIN-01/02 RED or ERROR (no `policyLayers`, and the file grant path must be proven).

- [ ] **Step 3: Implement**

`src/core/HTTP/server.js` — extend the return object (line 274):

```js
    return { api, plane, authState, challenges, engine, authMode, extensions, embedderInfo,
        policyLayers: () => ({ app: appPolicies, system: SYSTEM_BASELINES, admin: shippedAdmin, rows: dbPolicies }) }
```

`src/cli/commands/dev.js`:

1. Lines 75 and 91 — add `policyLayers` to both destructurings:

```js
    let { api, plane, authState, challenges, engine, authMode, embedderInfo, policyLayers } = await buildInstanceApi({ root, config, schemas, apps, appPolicies, mode: "dev" })
```

```js
        ;({ api, plane, authState, challenges, engine, authMode, embedderInfo, policyLayers } = await buildInstanceApi({ root, config, schemas, apps, appPolicies, mode: "dev" }))
```

2. DELETE the `/_studio/permissions` GET and POST handlers (lines 260-285, including their comment block).

3. In their place, add the window:

```js
        // The policy WINDOW (read-only, design 2026-07-19 §2): the exact
        // layers the engine composes, straight from its runtime arrays — the
        // UI can never drift from the enforced truth. Writes go through
        // /api/v1/nexus_policy ONLY.
        if (url.pathname === "/_studio/policies" && req.method === "GET") {
            const { app, system, admin, rows } = policyLayers()
            const byFile = new Map()
            for (const p of app) {
                const key = p.source ?? "app"
                if (!byFile.has(key)) byFile.set(key, [])
                byFile.get(key).push(p)
            }
            const layers = [
                ...[...byFile.entries()].map(([source, policies]) => ({ source, readonly: true, policies })),
                { source: "system", readonly: true, policies: system },
                { source: "admin", readonly: true, policies: admin },
                { source: "rows", readonly: false, policies: rows }
            ]
            return json(res, 200, { ok: true, data: { layers, devMode: !authState.required, authRequired: authState.required } })
        }
```

4. Guarantee the 404 pin: find where request routing falls through after the last `/_studio/` handler. If an unmatched `/_studio/*` path can reach the SPA/static fallthrough, add immediately after the last `/_studio/` handler:

```js
        // no other /_studio surface exists — dead paths (like the removed
        // /_studio/permissions) answer 404, never the SPA shell
        if (url.pathname.startsWith("/_studio/")) return json(res, 404, { ok: false, error: { code: "E_NOT_FOUND" } })
```

(If such a guard already exists, leave it; the clause proves it either way.)

- [ ] **Step 4: Run to verify GREEN**

Run: `npm test`
Expected: STUDIO-04/06/07 and POLWIN-01/02 green; every pre-existing STUDIO-* still green; 0 red.

- [ ] **Step 5: Commit**

```bash
git add src/core/HTTP/server.js src/cli/commands/dev.js test/http/studio.test.js test/http/policy-window.test.js
git commit -m "Policy window: /_studio/policies serves the engine's own layers; /_studio/permissions is dead (STUDIO-04/06/07, POLWIN-01/02)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: The editor tells the whole truth

**Files:**
- Modify: `src/studio/routes/permissions/index.js` (full rewrite below)
- Modify: `src/studio/routes/permissions/template.js` (add the baselines card)

**Interfaces:**
- Consumes: `GET /_studio/policies` (Task 3 shape), entity API `ctx.api.list/create/update/remove` (`list` → `{ ok, data: rows }`), `packPolicy` from `core/App/system.js` (browser-loadable per Task 2), `rolesIn` from `core/App/policies.js`, `<nx-permission-manager>` array contract (unknown keys pass through `.value` untouched — verify: its `clone` is JSON-based, so `id`/`source` survive).
- Produces: UI only. No automated clause (Studio settings/permissions pages are browser-verified — existing E2E debt); the suite must stay green.

- [ ] **Step 1: Template — add the baselines card**

In `src/studio/routes/permissions/template.js`, insert between the matrix card and the manager card:

```js
    <div class="nx-card" ${({ element }) => (c.$matrix = element)}></div>
    <div class="nx-card" ${({ element }) => (c.$baselines = element)}></div>
    <div class="nx-card" ${({ element }) => (c.$manager = element)}></div>
```

(Only the `$baselines` line is new; keep everything else in the file as is.)

- [ ] **Step 2: Rewrite the route logic**

Replace the entire contents of `src/studio/routes/permissions/index.js` with:

```js
/** /permissions route — the page tells the WHOLE truth (design 2026-07-19):
 *  every layer the engine composes — read-only baselines with their source
 *  labels + the editable nexus_policy ROWS — and the matrix verdict runs
 *  over the full composed set. Saving is a diff of ordinary entity-API row
 *  writes; there is no bespoke permissions write endpoint anymore. */

import { mountTemplate, toast } from "../../kit/index.js"
import "../../components/matrix/index.js"
import { rolesIn } from "../../../core/App/policies.js"
import { packPolicy } from "../../../core/App/system.js"
import { permissionsTemplate } from "./template.js"

// id/source are annotations — strip before comparing content
const strip = ({ id, source, ...policy }) => policy
const same = (a, b) => JSON.stringify(strip(a ?? {})) === JSON.stringify(strip(b ?? {}))
const parseRoles = (row) => { try { return row.roles ? JSON.parse(row.roles) : [] } catch { return [] } }

export function render(ctx) {
    const mgr = document.createElement("nx-permission-manager")
    mgr.schemas = ctx.schemas
    const matrix = document.createElement("nx-matrix")

    let baseline = [] // flattened read-only layers (each policy keeps its source)
    let saved = []    // the rows layer as last loaded: [{ id, …policy }]
    let users = []    // nexus_user rows (for the roles overview)
    const composed = (rows) => [...baseline, ...rows]

    const c = {}
    const host = mountTemplate(permissionsTemplate(c, {
        onSave: async () => {
            const value = mgr.value
            const before = new Map(saved.map((r) => [r.id, r]))
            const results = []
            for (const p of value) {
                if (!p.id) results.push(await ctx.api.create("nexus_policy", packPolicy(p)))
                else if (!before.has(p.id) || !same(p, before.get(p.id))) results.push(await ctx.api.update("nexus_policy", p.id, packPolicy(p)))
            }
            const kept = new Set(value.map((p) => p.id).filter(Boolean))
            for (const r of saved) if (!kept.has(r.id)) results.push(await ctx.api.remove("nexus_policy", r.id))
            const failed = results.filter((r) => !r.ok)
            if (!failed.length) toast("Policies saved — live now", "ok")
            else for (const f of failed) toast(f.error.code + ": " + (f.error.message || ""), "err") // per-row truth (spec §6)
            load() // re-sync from the window: partial saves are shown truthfully
        }
    }))
    c.$matrix.append(matrix)
    c.$manager.append(mgr)
    mgr.addEventListener("change", (e) => {
        matrix.policies = composed(e.detail.value)
        paintRoles(composed(e.detail.value))
    })

    /** The roles overview — each role is a BUNDLE: n policies grant through it, n users hold it. */
    function paintRoles(policies) {
        const overview = rolesIn(policies, users)
        c.$roles.replaceChildren()
        if (!overview.length) {
            const none = document.createElement("p")
            none.className = "nx-muted"
            none.textContent = "No roles yet — every policy below applies to all authenticated users."
            return c.$roles.append(none)
        }
        for (const r of overview) {
            const card = document.createElement("span")
            card.className = "nx-rolecard"
            const name = document.createElement("strong")
            name.textContent = r.role
            const spec = document.createElement("span")
            spec.className = "nx-muted"
            spec.textContent = `${r.policies} ${r.policies === 1 ? "policy" : "policies"} · ${r.users} ${r.users === 1 ? "user" : "users"}`
            card.append(name, spec)
            if (!r.policies) card.title = "Held by users but granting nothing — attach it to a policy below"
            if (!r.users) card.title = "Grants policies but nobody holds it — assign it in Users"
            c.$roles.append(card)
        }
    }

    /** Read-only layers, labeled by source — the floor the rows layer adds onto. */
    function paintBaselines(layers) {
        c.$baselines.replaceChildren()
        const head = document.createElement("h3")
        head.textContent = "Baselines (read-only)"
        const hint = document.createElement("p")
        hint.className = "nx-muted"
        hint.textContent = "Shipped floors — composition is additive, so these grants always hold. App files change through git; system and admin ship with nexus."
        c.$baselines.append(head, hint)
        for (const layer of layers) {
            if (!layer.policies.length) continue
            const src = document.createElement("p")
            src.className = "nx-muted"
            src.textContent = layer.source
            c.$baselines.append(src)
            for (const p of layer.policies) {
                const row = document.createElement("div")
                row.className = "nx-row"
                const who = document.createElement("div")
                who.className = "nx-who"
                const what = document.createElement("div")
                what.textContent = `${p.entity} · ${(p.actions ?? []).join(", ")}`
                const detail = document.createElement("div")
                detail.className = "nx-pub"
                detail.textContent = [p.roles?.length ? "roles: " + p.roles.join(", ") : "all authenticated", p.rule ? "rule-scoped" : null, p.ifOwner ? "ifOwner" : null].filter(Boolean).join(" · ")
                who.append(what, detail)
                row.append(who)
                c.$baselines.append(row)
            }
        }
    }

    async function load() {
        const [w, u] = await Promise.all([ctx.api.studio("policies", "GET"), ctx.api.list("nexus_user", null)])
        if (!w.ok) return
        users = u.ok ? u.data.map((row) => ({ ...row, roles: parseRoles(row) })) : []
        const layers = w.data.layers ?? []
        const readonly = layers.filter((l) => l.readonly)
        baseline = readonly.flatMap((l) => l.policies.map((p) => ({ ...p, source: p.source ?? l.source })))
        saved = layers.find((l) => l.source === "rows")?.policies ?? []
        mgr.value = saved
        matrix.policies = composed(saved)
        paintRoles(composed(saved))
        paintBaselines(readonly)
        c.$status.textContent = `${baseline.length} baseline · ${saved.length} rows`
        c.$banner.replaceChildren()
        if (w.data.devMode) {
            const card = document.createElement("div")
            card.className = "nx-card nx-note"
            const b = document.createElement("b")
            b.textContent = "DEV mode — policies are not enforced yet."
            const span = document.createElement("span")
            span.className = "nx-muted"
            span.textContent = " Without identities every request runs as the wide-open DEV admin, so nothing is denied. Add an identity in Users (e.g. “Add me as admin”) to turn authentication on — from that moment these policies decide who can do what."
            card.append(b, document.createElement("br"), span)
            c.$banner.append(card)
        }
    }
    load()
    return host
}
```

- [ ] **Step 3: Verify**

Run: `npm test` — the full suite stays green (no clause covers these two files).
Manual (dev box, joins the E2E debt list): `nexus dev` in a scratch instance → `/permissions` shows baseline sections + editable rows; add a policy → Save → row appears in `/api/v1/nexus_policy/query`; edit and delete round-trip; matrix reflects baselines even with zero rows.

- [ ] **Step 4: Commit**

```bash
git add src/studio/routes/permissions/index.js src/studio/routes/permissions/template.js
git commit -m "Permissions page: every layer visible, rows editable through the plane, matrix over the composed truth

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: STATUS.md + final sweep

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Update STATUS.md**

- In "Implemented & proven", System entities row: append to the text `; **permissions editor edits nexus_policy ROWS through the plane — layered read window /_studio/policies, additive-union contract pinned, bespoke POST dead**` and add `**PERM-U01, SYS-06..08, STUDIO-04/06/07, POLWIN-***` to its clauses cell.
- In "Unfinished / known drift": DELETE the first bullet ("Permissions page still saves the app-file baseline…") — it is fixed. Keep the `/_studio/users` bullet, but update its first sentence if it references the permissions page.

- [ ] **Step 2: Full suite + real flow**

Run: `npm test`
Expected: previous green + 8 new clauses (PERM-U01, SYS-06/07/08, STUDIO-06/07, POLWIN-01/02; STUDIO-04 replaced in place), 0 red.

Real-flow check (scratch dir, no downloads): create an instance, boot `nexus dev`, then with plain fetch/curl: create a valid `nexus_policy` row via `/api/v1/nexus_policy` (expect ok), an invalid one (expect `E_INVALID`), read `/_studio/policies` (expect the valid row under `rows`), and GET+POST `/_studio/permissions` (expect 404 both).

- [ ] **Step 3: Commit**

```bash
git add STATUS.md
git commit -m "STATUS: the permissions editor drift is closed — rows through the plane, window over the layers

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
