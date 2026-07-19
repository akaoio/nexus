/**
 * System entities (SYS-*) — "everything is an Entity": user, role, policy
 * (and the saved view) are builtin Model Schema v1 documents running the
 * SAME pipeline as any entity. The registry owns the `system` flag; rows
 * are ordinary data; the baselines ship self-service as DATA (Frappe's
 * lesson): admin grants come from a role, own-profile writes come from a
 * $CURRENT_USER rule — never an if-admin branch.
 */

import Test, { assert } from "../../src/core/Test.js"
import { SYSTEM_ENTITIES, SYSTEM_BASELINES, adminBaselines, isSystem, packPolicy, unpackPolicy, importIdentities } from "../../src/core/App/system.js"
import { validate } from "../../src/core/Model.js"
import { validatePolicy, policiesFor, loadPolicies } from "../../src/core/App/policies.js"
import { resolve } from "../../src/core/Permission.js"
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

Test.describe("System entities (SYS-*)", () => {
    Test.it("SYS-01 every system schema IS a valid Model Schema v1; the registry is pinned", () => {
        for (const schema of SYSTEM_ENTITIES)
            assert.equal(validate(schema).valid, true, `${schema.name} validates`)
        assert.deepEqual(SYSTEM_ENTITIES.map((s) => s.name).sort(), ["nexus_policy", "nexus_role", "nexus_user", "nexus_view"])
        for (const name of ["nexus_user", "nexus_role", "nexus_policy", "nexus_view", "nexus_entity"])
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
})
