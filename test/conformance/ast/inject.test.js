/**
 * Query AST v1 conformance — PERMISSION INJECTION (AST-I).
 *
 * Defines inject(query, permission): the mechanical AST composition used for
 * row-level security (ARCHITECTURE.md §4.3). Policy RESOLUTION (which
 * policies apply, additive union, deny-by-default) happens in the Permission
 * Engine above this layer — inject() itself is pure AST algebra.
 *
 * Spec decisions encoded here:
 *  - inject(q, p) = AND(q, p): a row passes only if it passes both.
 *  - inject(null-doc, p) = p; inject(q, null-doc) = q ("no restriction" at
 *    this layer; deny-by-default belongs to the engine above).
 *  - The result is a valid v1 document; inputs are never mutated.
 *  - THE security invariant: injection can only ever NARROW the result set.
 */

import Test, { assert } from "../../../src/kernel/Test.js"
import AST from "./_load.js"
import { doc, leaf, and, or, filter, ROWS } from "./_helpers.js"

const QUERY = doc(or(leaf("tier", "eq", "gold"), leaf("tier", "eq", "silver")))
const PERM = doc(leaf("owner", "eq", "u2"))

Test.describe("AST v1 — permission injection (AST-I)", () => {
    Test.it("AST-I01 inject(q, p) matches exactly the intersection", () => {
        const p = AST.predicate(AST.inject(QUERY, PERM))
        assert.deepEqual(filter(p, ROWS).map((r) => r.id), [2, 5])
    })

    Test.it("AST-I02 injecting into a match-all query applies the permission alone", () => {
        const p = AST.predicate(AST.inject(doc(null), PERM))
        assert.deepEqual(filter(p, ROWS).map((r) => r.id), [2, 5])
    })

    Test.it("AST-I03 a match-all permission leaves the query untouched in effect", () => {
        const p = AST.predicate(AST.inject(QUERY, doc(null)))
        assert.deepEqual(filter(p, ROWS).map((r) => r.id), [1, 2, 5])
    })

    Test.it("AST-I04 inject is pure — neither input document is mutated", () => {
        const q = JSON.stringify(QUERY)
        const perm = JSON.stringify(PERM)
        AST.inject(QUERY, PERM)
        assert.equal(JSON.stringify(QUERY), q)
        assert.equal(JSON.stringify(PERM), perm)
    })

    Test.it("AST-I05 the injected document is itself a valid v1 document", () => {
        assert.equal(AST.validate(AST.inject(QUERY, PERM)).valid, true)
        assert.equal(AST.validate(AST.inject(doc(null), doc(null))).valid, true)
    })

    Test.it("AST-I06 injection composes — permissions stack by repeated injection", () => {
        const stacked = AST.inject(AST.inject(QUERY, PERM), doc(leaf("age", "gt", 50)))
        assert.deepEqual(filter(AST.predicate(stacked), ROWS).map((r) => r.id), [5])
    })

    Test.it("AST-I07 SECURITY: injection never widens the result set", () => {
        const cases = [
            [QUERY, PERM],
            [doc(null), PERM],
            [QUERY, doc(null)],
            [doc(leaf("age", "isnull")), doc(leaf("owner", "in", ["u1", "u3"]))],
            [doc(and(leaf("active", "eq", true), leaf("score", "notnull"))), doc(leaf("tier", "ne", "gold"))]
        ]
        for (const [q, perm] of cases) {
            const base = new Set(filter(AST.predicate(q), ROWS).map((r) => r.id))
            const permitted = new Set(filter(AST.predicate(perm), ROWS).map((r) => r.id))
            const injected = filter(AST.predicate(AST.inject(q, perm)), ROWS).map((r) => r.id)
            for (const id of injected) {
                assert.truthy(base.has(id), `row ${id} leaked past the query filter`)
                assert.truthy(permitted.has(id), `row ${id} leaked past the permission filter`)
            }
        }
    })
})
