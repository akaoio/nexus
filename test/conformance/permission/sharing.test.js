/**
 * Permission v1 conformance — DOCUMENT SHARING (PERM-SH).
 *
 * Defines ad-hoc per-document grants (Frappe's document sharing, §4.3):
 * a share gives one user access to one document for specific actions,
 * outside the role/policy system.
 *
 * Spec decisions encoded here:
 *  - Share shape: { id, user, actions: [...] }.
 *  - Shares are passed to resolve() as a third argument; matching shares
 *    make the document reachable even with ZERO applicable policies —
 *    the filter becomes (policy-union OR id-in-shared-ids).
 *  - Shares are per-user and per-action; they never leak.
 */

import Test, { assert } from "../../../src/core/Test.js"
import Permission from "./_load.js"
import AST from "../ast/_load.js"
import { policy, ctx, rule, ROWS, filter } from "./_helpers.js"

const rowsFor = (result) =>
    filter(AST.predicate(result.filter === null ? { astVersion: 1, root: null } : result.filter), ROWS).map(
        (r) => r.id
    )

Test.describe("Permission v1 — document sharing (PERM-SH)", () => {
    Test.it("PERM-SH01 a share grants access to the shared document with zero policies", () => {
        const shares = [{ id: 3, user: "u1", actions: ["read"] }]
        const result = Permission.resolve([], ctx({ user: "u1" }), shares)
        assert.equal(result.allowed, true)
        assert.deepEqual(rowsFor(result), [3])
    })

    Test.it("PERM-SH02 shares are per-user — another user's share does not apply", () => {
        const shares = [{ id: 3, user: "u9", actions: ["read"] }]
        const result = Permission.resolve([], ctx({ user: "u1" }), shares)
        assert.equal(result.allowed, false)
    })

    Test.it("PERM-SH03 shares are per-action — a read share does not grant write", () => {
        const shares = [{ id: 3, user: "u1", actions: ["read"] }]
        const result = Permission.resolve([], ctx({ user: "u1", action: "write" }), shares)
        assert.equal(result.allowed, false)
    })

    Test.it("PERM-SH04 shares OR with the policy union — never replace it", () => {
        const gold = policy({ rule: rule("tier", "eq", "gold") })
        const shares = [{ id: 3, user: "u1", actions: ["read"] }]
        const result = Permission.resolve([gold], ctx({ user: "u1" }), shares)
        assert.deepEqual(rowsFor(result), [1, 3, 5]) // gold rows ∪ shared row 3
    })

    Test.it("PERM-SH05 multiple shares aggregate into one id-set", () => {
        const shares = [
            { id: 2, user: "u1", actions: ["read"] },
            { id: 3, user: "u1", actions: ["read", "write"] },
            { id: 4, user: "u9", actions: ["read"] }
        ]
        const result = Permission.resolve([], ctx({ user: "u1" }), shares)
        assert.deepEqual(rowsFor(result), [2, 3])
    })
})
