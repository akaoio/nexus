/**
 * Roles overview (ROLE-*) — a role is a NAME bundling policies (the profile
 * the author asked for): policies carry it, identities hold it, rolesIn()
 * aggregates the two sides into the picture the permissions page renders.
 */

import Test, { assert } from "../../src/core/Test.js"
import { rolesIn, policiesFor } from "../../src/core/App/policies.js"

Test.describe("Roles as bundles (ROLE-*)", () => {
    const POLICIES = [
        { entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }, // baseline — no role
        { entity: "task", actions: ["write", "create"], rule: null, permlevel: 0, ifOwner: false, roles: ["editor"] },
        { entity: "task", actions: ["delete"], rule: null, permlevel: 0, ifOwner: false, roles: ["admin", "editor"] }
    ]
    const IDENTITIES = [
        { pub: "pk1", name: "an", roles: ["admin"] },
        { pub: "pk2", name: "binh", roles: ["editor"] },
        { pub: "pk3", name: "chi", roles: ["editor", "viewer"] }
    ]

    Test.it("ROLE-01 rolesIn aggregates both sides — sorted, counted, union of sources", () => {
        assert.deepEqual(rolesIn(POLICIES, IDENTITIES), [
            { role: "admin", policies: 1, users: 1 },
            { role: "editor", policies: 2, users: 2 },
            { role: "viewer", policies: 0, users: 1 } // held but not yet granted — visible, not hidden
        ])
        assert.deepEqual(rolesIn(), [])
    })

    Test.it("ROLE-02 the bundle grants exactly what its policies say (policiesFor agreement)", () => {
        assert.deepEqual(policiesFor(POLICIES, ["editor"]).map((p) => p.actions.join()), ["read", "write,create", "delete"])
        assert.deepEqual(policiesFor(POLICIES, ["viewer"]).map((p) => p.actions.join()), ["read"]) // baseline only
        assert.deepEqual(policiesFor(POLICIES, []).map((p) => p.actions.join()), ["read"])
    })
})
