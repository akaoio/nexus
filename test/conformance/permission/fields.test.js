/**
 * Permission v1 conformance — FIELD-LEVEL ACCESS (PERM-F).
 *
 * Defines Permission.fields(policies, ctx, schema) → sorted array of field
 * names accessible for the requested action (Frappe permlevel semantics,
 * §4.3). The UI hides what's absent; the server strips it from
 * SELECT/UPDATE — same list, both sides.
 *
 * Spec decisions encoded here:
 *  - A field's permlevel defaults to 0.
 *  - A policy grants access to fields AT its own permlevel only (Frappe
 *    semantics: level rules are per-level, not "this level and below").
 *  - Field access requires document access: without any permlevel-0 policy
 *    for the action, fields() is empty regardless of higher-level policies.
 *  - System fields (id, owner, created_at, updated_at) ride at permlevel 0.
 *  - Field access unions across policies, per action.
 */

import Test, { assert } from "../../../src/kernel/Test.js"
import Permission from "./_load.js"
import { policy, ctx } from "./_helpers.js"
import { schema, field } from "../model/_helpers.js"

const SCHEMA = schema({
    fields: [
        field("full_name", "text", { required: true }),
        field("tier", "select", { options: ["bronze", "silver", "gold"] }),
        field("salary", "number", { permlevel: 2 }),
        field("notes", "text", { permlevel: 5 })
    ]
})

const SYSTEM = ["created_at", "id", "owner", "updated_at"]

Test.describe("Permission v1 — field-level access (PERM-F)", () => {
    Test.it("PERM-F01 a permlevel-0 policy grants exactly the level-0 fields plus system fields", () => {
        const names = Permission.fields([policy()], ctx(), SCHEMA)
        assert.deepEqual([...names].sort(), [...SYSTEM, "full_name", "tier"].sort())
    })

    Test.it("PERM-F02 higher-permlevel fields stay hidden without a matching-level policy", () => {
        const names = Permission.fields([policy()], ctx(), SCHEMA)
        assert.falsy(names.includes("salary"))
        assert.falsy(names.includes("notes"))
    })

    Test.it("PERM-F03 a matching-level policy extends field access (union across policies)", () => {
        const names = Permission.fields([policy(), policy({ permlevel: 2 })], ctx(), SCHEMA)
        assert.truthy(names.includes("salary"))
        assert.falsy(names.includes("notes"), "level 2 does not unlock level 5")
    })

    Test.it("PERM-F04 a policy grants its own level only — level 2 does not imply level 0", () => {
        const names = Permission.fields([policy({ permlevel: 2 })], ctx(), SCHEMA)
        assert.deepEqual(names, [], "no doc access without a permlevel-0 policy → no fields at all")
    })

    Test.it("PERM-F05 field access is per action", () => {
        const readAll = policy({ actions: ["read"], permlevel: 2 })
        const readBase = policy({ actions: ["read"] })
        const writeBase = policy({ actions: ["write"] })
        const readNames = Permission.fields([readBase, readAll, writeBase], ctx({ action: "read" }), SCHEMA)
        const writeNames = Permission.fields([readBase, readAll, writeBase], ctx({ action: "write" }), SCHEMA)
        assert.truthy(readNames.includes("salary"))
        assert.falsy(writeNames.includes("salary"), "level-2 read grant must not leak into write")
    })

    Test.it("PERM-F06 fields() honours entity and action matching like resolve()", () => {
        const other = policy({ entity: "invoice" })
        assert.deepEqual(Permission.fields([other], ctx(), SCHEMA), [])
        const wrongAction = policy({ actions: ["write"] })
        assert.deepEqual(Permission.fields([wrongAction], ctx({ action: "read" }), SCHEMA), [])
    })

    Test.it("PERM-F07 the result is sorted and duplicate-free", () => {
        const names = Permission.fields([policy(), policy(), policy({ permlevel: 2 })], ctx(), SCHEMA)
        assert.deepEqual([...names], [...new Set(names)].sort())
    })
})
