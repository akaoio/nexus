/**
 * Permission v1 conformance — ROW-LEVEL RULES (PERM-R).
 *
 * Defines how policy rules (AST documents) combine into the filter that
 * resolve() returns — the filter that is then AND-injected into every query
 * via AST.inject (§4.2/§4.3).
 *
 * Spec decisions encoded here:
 *  - Policies are ADDITIVE (Directus v11): the filters of all applicable
 *    permlevel-0 policies combine with OR.
 *  - Any applicable policy with rule null is unrestricted → filter null
 *    (the OR short-circuits to match-all).
 *  - ifOwner ANDs { owner eq $CURRENT_USER } into that policy's own rule
 *    (Frappe's "if owner", per policy, before the OR-union).
 *  - The returned filter is FULLY RESOLVED (no dynamic variables left) and
 *    is a valid AST v1 document — ready for AST.inject with zero further
 *    processing.
 *  - resolve() is pure: the policy list and documents are never mutated.
 */

import Test, { assert } from "../../../src/core/Test.js"
import Permission from "./_load.js"
import AST from "../ast/_load.js"
import { policy, ctx, rule, ROWS, filter } from "./_helpers.js"

const rowsFor = (result) =>
    filter(AST.predicate(result.filter === null ? { astVersion: 1, root: null } : result.filter), ROWS).map(
        (r) => r.id
    )

Test.describe("Permission v1 — row-level rules (PERM-R)", () => {
    Test.it("PERM-R01 a rule's dynamic variables come back fully resolved", () => {
        const p = policy({ rule: rule("owner", "eq", "$CURRENT_USER") })
        const result = Permission.resolve([p], ctx({ user: "u2" }))
        assert.equal(result.allowed, true)
        assert.equal(JSON.stringify(result.filter).includes("$CURRENT_USER"), false)
        assert.deepEqual(rowsFor(result), [2, 5])
    })

    Test.it("PERM-R02 ADDITIVE UNION — multiple policies OR their rules", () => {
        const gold = policy({ rule: rule("tier", "eq", "gold") })
        const own = policy({ rule: rule("owner", "eq", "$CURRENT_USER") })
        const result = Permission.resolve([gold, own], ctx({ user: "u3" }))
        assert.deepEqual(rowsFor(result), [1, 4, 5]) // gold rows ∪ u3's rows
    })

    Test.it("PERM-R03 an unrestricted policy short-circuits the union to match-all", () => {
        const restricted = policy({ rule: rule("tier", "eq", "gold") })
        const unrestricted = policy()
        const result = Permission.resolve([restricted, unrestricted], ctx())
        assert.equal(result.filter, null)
        assert.deepEqual(rowsFor(result), [1, 2, 3, 4, 5])
    })

    Test.it("PERM-R04 ifOwner alone restricts to the requester's rows", () => {
        const p = policy({ ifOwner: true })
        const result = Permission.resolve([p], ctx({ user: "u1" }))
        assert.deepEqual(rowsFor(result), [1, 3])
    })

    Test.it("PERM-R05 ifOwner ANDs with the policy's own rule before the union", () => {
        const p = policy({ ifOwner: true, rule: rule("tier", "eq", "gold") })
        const result = Permission.resolve([p], ctx({ user: "u2" }))
        assert.deepEqual(rowsFor(result), [5]) // u2's rows ∩ gold
    })

    Test.it("PERM-R06 ifOwner on one policy does not leak into sibling policies", () => {
        const owned = policy({ ifOwner: true })
        const gold = policy({ rule: rule("tier", "eq", "gold") })
        const result = Permission.resolve([owned, gold], ctx({ user: "u3" }))
        assert.deepEqual(rowsFor(result), [1, 4, 5]) // u3's rows ∪ gold rows
    })

    Test.it("PERM-R07 the returned filter is a valid AST v1 document, composable with inject", () => {
        const p = policy({ rule: rule("tier", "in", ["gold", "silver"]) })
        const result = Permission.resolve([p], ctx())
        assert.equal(AST.validate(result.filter).valid, true)
        const injected = AST.inject({ astVersion: 1, root: { field: "age", operator: "gt", value: 20 } }, result.filter)
        assert.equal(AST.validate(injected).valid, true)
    })

    Test.it("PERM-R08 resolve is pure — policies and their rule documents are not mutated", () => {
        const policies = [policy({ rule: rule("owner", "eq", "$CURRENT_USER"), ifOwner: true })]
        const snapshot = JSON.stringify(policies)
        Permission.resolve(policies, ctx())
        assert.equal(JSON.stringify(policies), snapshot)
    })

    Test.it("PERM-R09 SECURITY — the union grants exactly what the policies grant, nothing more", () => {
        const gold = policy({ rule: rule("tier", "eq", "gold") })
        const own = policy({ ifOwner: true })
        const result = Permission.resolve([gold, own], ctx({ user: "u2" }))
        const granted = new Set(rowsFor(result))
        // Row 3 (bronze, owner u1) matches neither policy for u2 — must not appear.
        assert.falsy(granted.has(3), "row outside every policy leaked into the filter")
        assert.deepEqual([...granted].sort(), [1, 2, 5])
    })
})
