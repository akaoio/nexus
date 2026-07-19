/**
 * Permission v1 conformance — RESOLUTION & ACTIONS (PERM-A).
 *
 * Defines Permission.resolve(policies, ctx) → { allowed, filter }: the
 * doc-level access decision (ARCHITECTURE.md §4.3).
 *
 * Spec decisions encoded here:
 *  - v1 action set (7, closed, frozen — Frappe's document lifecycle):
 *    read write create delete submit cancel amend.
 *  - DENY BY DEFAULT: no applicable policy → { allowed: false }. This is
 *    the constitution of the engine; everything else is carve-outs.
 *  - A policy applies iff its entity matches AND its actions include the
 *    requested action AND its permlevel is 0. Higher-permlevel policies
 *    NEVER grant document access — they only extend field access (PERM-F),
 *    faithful to Frappe's permlevel model.
 *  - resolve() validates inputs loudly: unknown action in ctx or in a
 *    policy throws E_UNKNOWN_ACTION; bad permlevel throws E_PERMLEVEL.
 */

import Test, { assert } from "../../../src/core/Test.js"
import Permission from "./_load.js"
import { policy, ctx, rule } from "./_helpers.js"

Test.describe("Permission v1 — resolution & actions (PERM-A)", () => {
    Test.it("PERM-A01 the v1 action set is exactly these 7, frozen", () => {
        assert.deepEqual(
            [...Permission.ACTIONS].sort(),
            ["amend", "cancel", "create", "delete", "read", "submit", "write"]
        )
        assert.truthy(Object.isFrozen(Permission.ACTIONS))
    })

    Test.it("PERM-A02 DENY BY DEFAULT — zero policies means no access", () => {
        const result = Permission.resolve([], ctx())
        assert.equal(result.allowed, false)
    })

    Test.it("PERM-A03 a policy for another entity does not grant", () => {
        const result = Permission.resolve([policy({ entity: "invoice" })], ctx())
        assert.equal(result.allowed, false)
    })

    Test.it("PERM-A04 a policy without the requested action does not grant", () => {
        const result = Permission.resolve([policy({ actions: ["write"] })], ctx({ action: "read" }))
        assert.equal(result.allowed, false)
    })

    Test.it("PERM-A05 a matching unrestricted policy grants with filter null", () => {
        const result = Permission.resolve([policy()], ctx())
        assert.equal(result.allowed, true)
        assert.equal(result.filter, null)
    })

    Test.it("PERM-A06 each lifecycle action is granted independently", () => {
        const p = policy({ actions: ["read", "write", "submit"] })
        for (const action of ["read", "write", "submit"]) {
            assert.equal(Permission.resolve([p], ctx({ action })).allowed, true, action)
        }
        for (const action of ["create", "delete", "cancel", "amend"]) {
            assert.equal(Permission.resolve([p], ctx({ action })).allowed, false, action)
        }
    })

    Test.it("PERM-A07 a permlevel>0 policy NEVER grants document access", () => {
        const result = Permission.resolve([policy({ permlevel: 2 })], ctx())
        assert.equal(result.allowed, false)
    })

    Test.it("PERM-A08 unknown actions are rejected loudly with E_UNKNOWN_ACTION", () => {
        assert.throws(() => Permission.resolve([policy()], ctx({ action: "publish" })), "E_UNKNOWN_ACTION")
        assert.throws(() => Permission.resolve([policy({ actions: ["publish"] })], ctx()), "E_UNKNOWN_ACTION")
    })

    Test.it("PERM-A09 a policy with an invalid permlevel throws E_PERMLEVEL", () => {
        assert.throws(() => Permission.resolve([policy({ permlevel: 10 })], ctx()), "E_PERMLEVEL")
        assert.throws(() => Permission.resolve([policy({ permlevel: -1 })], ctx()), "E_PERMLEVEL")
    })

    Test.it("PERM-A10 a policy with an invalid rule document throws E_INVALID", () => {
        const bad = policy({ rule: { astVersion: 1, root: { op: "xor", children: [] } } })
        assert.throws(() => Permission.resolve([bad], ctx()), "E_INVALID")
    })

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
})
