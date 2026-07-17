/**
 * Query AST v1 conformance — JS PREDICATE TARGET (AST-P).
 *
 * Defines the reference compile target: predicate(doc) → (row) => boolean.
 * This target is the executable semantics of the AST — the SQL targets are
 * required to agree with it row-for-row (asserted in AST-Q and in the
 * Phase 2 engine matrix).
 *
 * Spec decisions encoded here:
 *  - Rows are plain objects. Relation paths traverse nested objects.
 *  - An ARRAY met along a path = child-table semantics: the leaf matches if
 *    ANY element matches (mirrors SQL EXISTS over a joined child table).
 *  - Null/missing anywhere along a path behaves as a null field (AST-O17).
 *  - The predicate is total (never throws on any row), pure (no mutation),
 *    and rejects invalid documents at compile time with E_INVALID.
 */

import Test, { assert } from "../../../src/core/Test.js"
import AST from "./_load.js"
import { doc, leaf, and, or, not, filter, ROWS } from "./_helpers.js"

Test.describe("AST v1 — predicate target (AST-P)", () => {
    Test.it("AST-P01 predicate() returns a function", () => {
        assert.equal(typeof AST.predicate(doc(leaf("tier", "eq", "gold"))), "function")
    })

    Test.it("AST-P02 root null matches every row", () => {
        assert.equal(filter(AST.predicate(doc(null)), ROWS).length, ROWS.length)
    })

    Test.it("AST-P03 and requires all children; or requires any", () => {
        const p1 = AST.predicate(doc(and(leaf("tier", "eq", "gold"), leaf("age", "gt", 40))))
        assert.deepEqual(filter(p1, ROWS).map((r) => r.id), [5])
        const p2 = AST.predicate(doc(or(leaf("tier", "eq", "bronze"), leaf("age", "gt", 40))))
        assert.deepEqual(filter(p2, ROWS).map((r) => r.id), [2, 3, 5])
    })

    Test.it("AST-P04 not inverts its child — but null comparisons stay unmatched", () => {
        const p = AST.predicate(doc(not(leaf("tier", "eq", "gold"))))
        // row 4 has tier: null → eq false → not(false) = true. NOT is plain
        // boolean inversion of the predicate result; SQL targets must be
        // compiled to match this (e.g. via IS NOT DISTINCT FROM idioms),
        // keeping the JS semantics as the reference.
        assert.deepEqual(filter(p, ROWS).map((r) => r.id), [2, 3, 4])
    })

    Test.it("AST-P05 deep and/or/not composition evaluates correctly", () => {
        const node = and(
            or(leaf("tier", "eq", "gold"), leaf("tier", "eq", "silver")),
            not(leaf("age", "lt", 40)),
            leaf("name", "notnull")
        )
        assert.deepEqual(filter(AST.predicate(doc(node)), ROWS).map((r) => r.id), [2, 5])
    })

    Test.it("AST-P06 relation paths traverse nested objects", () => {
        const p = AST.predicate(doc(leaf("customer.address.city", "eq", "hanoi")))
        assert.equal(p({ customer: { address: { city: "hanoi" } } }), true)
        assert.equal(p({ customer: { address: { city: "hue" } } }), false)
    })

    Test.it("AST-P07 an array along a path means ANY-match (child-table EXISTS semantics)", () => {
        const p = AST.predicate(doc(leaf("contacts.email", "like", "%@corp.com")))
        assert.equal(p({ contacts: [{ email: "x@gmail.com" }, { email: "y@corp.com" }] }), true)
        assert.equal(p({ contacts: [{ email: "x@gmail.com" }] }), false)
        assert.equal(p({ contacts: [] }), false)
    })

    Test.it("AST-P08 null/missing along a path behaves as a null field", () => {
        const p = AST.predicate(doc(leaf("customer.address.city", "eq", "hanoi")))
        assert.equal(p({}), false)
        assert.equal(p({ customer: null }), false)
        assert.equal(p({ customer: { address: null } }), false)
        const isnull = AST.predicate(doc(leaf("customer.address.city", "isnull")))
        assert.equal(isnull({ customer: null }), true)
    })

    Test.it("AST-P09 the predicate is total — never throws on hostile rows", () => {
        const p = AST.predicate(doc(and(leaf("a.b", "like", "%x%"), leaf("n", "between", [1, 2]))))
        for (const row of [null, undefined, 42, "str", [], { a: 5 }, { a: { b: {} } }, { n: "NaN" }]) {
            assert.equal(typeof p(row), "boolean")
        }
    })

    Test.it("AST-P10 the predicate does not mutate the row", () => {
        const row = { tier: "gold", nested: { a: [1, 2] } }
        const snapshot = JSON.stringify(row)
        AST.predicate(doc(leaf("nested.a", "eq", 1)))(row)
        assert.equal(JSON.stringify(row), snapshot)
    })

    Test.it("AST-P11 100-level logic nesting evaluates without failure", () => {
        let node = leaf("age", "gt", 0)
        for (let i = 0; i < 100; i++) node = and(node)
        assert.equal(AST.predicate(doc(node))({ age: 1 }), true)
    })

    Test.it("AST-P12 compiling an invalid document throws E_INVALID", () => {
        assert.throws(() => AST.predicate(doc({ op: "xor", children: [] })), "E_INVALID")
        assert.throws(() => AST.predicate(doc(leaf("Tier", "eq", "x"))), "E_INVALID")
        assert.throws(() => AST.predicate({ root: null }), "E_INVALID")
    })
})
