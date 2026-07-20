/**
 * System entities (SYS-*) — "everything is an Entity": user, role, policy
 * (and the saved view) are builtin Model Schema v1 documents running the
 * SAME pipeline as any entity. The registry owns the `system` flag; rows
 * are ordinary data; the baselines ship self-service as DATA (Frappe's
 * lesson): admin grants come from a role, own-profile writes come from a
 * $CURRENT_USER rule — never an if-admin branch.
 */

import Test, { assert } from "../../src/core/Test.js"
import { SYSTEM_ENTITIES, SYSTEM_BASELINES, adminBaselines, isSystem, packPolicy, unpackPolicy, validatePolicyRow, unpackPolicyRows, importIdentities, SERVER_ONLY, isServerOnly } from "../../src/core/App/system.js"
import { validate } from "../../src/core/Model.js"
import { validatePolicy, policiesFor, loadPolicies } from "../../src/core/App/policies.js"
import { resolve, fields } from "../../src/core/Permission.js"
import { NEXUS_CTX_POLICIES } from "../../src/core/HTTP/server.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

/** A real in-memory SQLite plane over SYSTEM_ENTITIES — for SYS-12, which
 *  must drive the actual escalation through Permission.fields + Data's
 *  #validateData, not merely assert over the two in isolation. */
function makePlane() {
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const schema of SYSTEM_ENTITIES)
        for (const builder of tableDDL(kysely, schema)) db.exec(builder.compile().sql)
    const executor = {
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: (sql, params = []) => db.prepare(sql).all(...params)
    }
    return new DataPlane({ executor, schemas: SYSTEM_ENTITIES, dialect: "sqlite" })
}

Test.describe("System entities (SYS-*)", () => {
    Test.it("SYS-01 every system schema IS a valid Model Schema v1; the registry is pinned", () => {
        for (const schema of SYSTEM_ENTITIES)
            assert.equal(validate(schema).valid, true, `${schema.name} validates`)
        assert.deepEqual(SYSTEM_ENTITIES.map((s) => s.name).sort(), ["nexus_job", "nexus_notification", "nexus_policy", "nexus_role", "nexus_user", "nexus_view", "nexus_webhook"])
        for (const name of ["nexus_user", "nexus_role", "nexus_policy", "nexus_view", "nexus_entity", "nexus_job", "nexus_webhook", "nexus_notification"])
            assert.truthy(isSystem(name), `${name} is system`)
        assert.truthy(!isSystem("task"), "app entities are not system")
    })

    Test.it("SYS-02 packPolicy/unpackPolicy round-trip — JSON columns carry arrays and rules losslessly", () => {
        const policy = {
            entity: "task", actions: ["read", "write"], permlevel: 0, ifOwner: false,
            rule: { astVersion: 1, root: { field: "done", operator: "eq", value: false } },
            roles: ["editor"]
        }
        const row = packPolicy(policy)
        assert.equal(typeof row.actions, "string")
        assert.equal(typeof row.rule, "string")
        const back = unpackPolicy({ id: "01X", owner: "dev", ...row })
        assert.deepEqual(back, policy)
        assert.equal(validatePolicy(back).valid, true)
        // a null rule stays null through the trip
        const open = unpackPolicy({ ...packPolicy({ entity: "task", actions: ["read"], permlevel: 0, ifOwner: false, rule: null }) })
        assert.equal(open.rule, null)
        assert.equal(open.roles, undefined) // no roles = authenticated baseline, key absent
    })

    Test.it("SYS-03 baselines ship self-service as DATA: admin everywhere, own-profile via $CURRENT_USER", () => {
        for (const policy of SYSTEM_BASELINES) assert.equal(validatePolicy(policy).valid, true, policy.entity)
        // an authenticated user with NO roles: may read roles, and write ONLY their own nexus_user row
        const mine = policiesFor(SYSTEM_BASELINES, [])
        const verdict = resolve(mine, { entity: "nexus_user", action: "write", user: "PUBKEY1", roles: [] })
        assert.equal(verdict.allowed, true)
        assert.deepEqual(verdict.filter.root, { field: "pub", operator: "eq", value: "PUBKEY1" })
        // admin passes unrestricted on every system entity, for every lifecycle action it ships
        const admins = policiesFor(SYSTEM_BASELINES, ["admin"])
        for (const entity of ["nexus_user", "nexus_role", "nexus_policy", "nexus_view"]) {
            const v = resolve(admins, { entity, action: "delete", user: "A", roles: ["admin"] })
            assert.equal(v.allowed, true, `admin deletes on ${entity}`)
            assert.equal(v.filter, null, `admin unrestricted on ${entity}`)
        }
        // no policy grants a roleless user delete on nexus_policy (deny-by-default holds)
        assert.equal(resolve(mine, { entity: "nexus_policy", action: "delete", user: "P", roles: [] }).allowed, false)
    })

    Test.it("SYS-05 adminBaselines: the admin bundle covers every LOADED entity — generated data, no wildcard in the engine", () => {
        const schemas = [{ name: "task" }, { name: "nexus_user" }]
        const bundle = adminBaselines(schemas)
        for (const policy of bundle) assert.equal(validatePolicy(policy).valid, true, policy.entity)
        const grants = policiesFor(bundle, ["admin"])
        for (const entity of ["task", "nexus_user"]) {
            const verdict = resolve(grants, { entity, action: "delete", user: "A", roles: ["admin"] })
            assert.equal(verdict.allowed, true, `admin on ${entity}`)
        }
        // without the role, the generated bundle grants NOTHING (deny-by-default)
        assert.equal(resolve(policiesFor(bundle, []), { entity: "task", action: "read", user: "U", roles: [] }).allowed, false)
    })

    Test.it("SYS-04 importIdentities maps config identities to nexus_user rows (bootstrap, one-way)", () => {
        const rows = importIdentities([
            { pub: "PK1", name: "an", roles: ["admin"] },
            { pub: "PK2", roles: [] }
        ])
        assert.equal(rows.length, 2)
        assert.equal(rows[0].pub, "PK1")
        assert.equal(rows[0].name, "an")
        assert.deepEqual(JSON.parse(rows[0].roles), ["admin"])
        assert.equal(rows[1].name, "PK2") // a nameless identity is addressed by its pub
        assert.deepEqual(importIdentities(undefined), [])
    })

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

    Test.it("SYS-09 effect entities: nexus_job/webhook/notification are system docs; job+webhook are SERVER-ONLY (never sync)", () => {
        const names = SYSTEM_ENTITIES.map((s) => s.name)
        for (const n of ["nexus_job", "nexus_webhook", "nexus_notification"]) {
            assert.truthy(names.includes(n), n)
            assert.truthy(isSystem(n), n + " is system")
        }
        const job = SYSTEM_ENTITIES.find((s) => s.name === "nexus_job")
        const f = Object.fromEntries(job.fields.map((x) => [x.name, x]))
        assert.equal(f.name.required, true)
        assert.deepEqual(f.status.options, ["pending", "running", "done", "failed", "dead"])
        assert.equal(f.status.default, "pending")
        assert.equal(f.max_attempts.default, 5)
        for (const col of ["payload", "run_at", "every_ms", "attempts", "lease_until", "lease_token", "last_error", "result"]) assert.truthy(f[col], col)
        const wh = SYSTEM_ENTITIES.find((s) => s.name === "nexus_webhook")
        assert.equal(Object.fromEntries(wh.fields.map((x) => [x.name, x])).url.required, true)
        const notif = SYSTEM_ENTITIES.find((s) => s.name === "nexus_notification")
        assert.equal(Object.fromEntries(notif.fields.map((x) => [x.name, x])).user.required, true)
        // the honest line: replication ≠ work distribution
        assert.deepEqual([...SERVER_ONLY], ["nexus_job", "nexus_webhook"])
        assert.equal(isServerOnly("nexus_job"), true)
        assert.equal(isServerOnly("nexus_notification"), false)
        // every schema must pass the framework's own validation
        for (const s of SYSTEM_ENTITIES) assert.equal(validate(s).valid, true, s.name)
    })

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

    Test.it("SYS-12 the escalation itself: a roleless actor patching its own roles is refused by the plane", async () => {
        // real in-memory plane over SYSTEM_ENTITIES (copy of the setup in
        // test/app/jobs.test.js) — SYS-10/11 assert over the baselines and
        // schema in isolation; this drives the actual attack through the
        // plane so Permission.fields composing with #validateData is proven,
        // not merely trusted.
        const plane = makePlane()
        const SELF = { user: "pubP", roles: [], shares: [], policies: SYSTEM_BASELINES.filter((p) => !p.roles) }
        const ADMIN = { user: "pubA", roles: ["admin"], shares: [], policies: SYSTEM_BASELINES.filter((p) => !p.roles || p.roles.includes("admin")) }
        const row = await plane.create("nexus_user", { pub: "pubP", name: "P", roles: JSON.stringify([]) }, ADMIN)
        let threw = null
        try { await plane.update("nexus_user", row.id, { roles: JSON.stringify(["admin"]) }, SELF) } catch (e) { threw = e }
        assert.truthy(String(threw?.message).includes("E_FIELD_FORBIDDEN"), "the escalation must be refused at the plane")
        assert.deepEqual(JSON.parse((await plane.get("nexus_user", row.id, ADMIN)).roles), [], "and the row must be unchanged")
        // the ordinary self-service edit still works — the fix must not break the feature
        const ok = await plane.update("nexus_user", row.id, { name: "P2" }, SELF)
        assert.equal(ok.name, "P2")
        // admin can still manage roles
        await plane.update("nexus_user", row.id, { roles: JSON.stringify(["editor"]) }, ADMIN)
        assert.deepEqual(JSON.parse((await plane.get("nexus_user", row.id, ADMIN)).roles), ["editor"])
    })

    Test.it("SYS-13 NEXUS_CTX stays a narrow internal actor: read+create only, no write, no delete", () => {
        // NEXUS_CTX_POLICIES is exported from src/core/HTTP/server.js precisely
        // so this invariant can be pinned rather than trusted by hand.
        for (const p of NEXUS_CTX_POLICIES) {
            assert.equal(p.actions.includes("write"), false, `${p.entity} pl${p.permlevel}: no write`)
            assert.equal(p.actions.includes("delete"), false, `${p.entity} pl${p.permlevel}: no delete`)
            assert.truthy(["nexus_user", "nexus_policy"].includes(p.entity), "only the bootstrap entities")
        }
        // and sufficient: it must cover every permlevel present on nexus_user
        const user = SYSTEM_ENTITIES.find((s) => s.name === "nexus_user")
        const levels = new Set(user.fields.map((f) => f.permlevel ?? 0))
        for (const lvl of levels)
            assert.truthy(NEXUS_CTX_POLICIES.some((p) => p.entity === "nexus_user" && (p.permlevel ?? 0) === lvl),
                `bootstrap must cover permlevel ${lvl} or identity import breaks`)
    })
})
