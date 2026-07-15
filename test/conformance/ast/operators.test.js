/**
 * Query AST v1 conformance — OPERATOR SEMANTICS (AST-O).
 *
 * Defines the meaning of every operator in the closed v1 set, exercised
 * through the JS predicate target (the reference semantics). The SQL targets
 * must match these results row-for-row (property clause AST-Q, and the
 * Phase 2 golden/matrix suites).
 *
 * Spec decisions encoded here:
 *  - v1 operator set (13, closed): eq ne gt gte lt lte in nin like nlike
 *    isnull notnull between.
 *  - No type coercion, ever: eq compares with strict equality semantics.
 *  - SQL WHERE null semantics: any comparison against a null/missing field
 *    value is false — including ne, nin and nlike (mirrors SQL three-valued
 *    logic as observed through WHERE). Only isnull matches null/missing.
 *  - Ordering (gt/gte/lt/lte, between): numbers numerically; strings by code
 *    unit (safe for ISO-8601 dates; declared ASCII-only guarantee).
 *  - like: % = any run, _ = one char, backslash escapes % _ \; matching is
 *    case-insensitive for ASCII; pattern is anchored (whole-value match).
 *  - between is inclusive of both bounds.
 */

import Test, { assert } from "../../../src/kernel/Test.js"
import AST from "./_load.js"
import { doc, leaf } from "./_helpers.js"

const match = (node, row) => AST.predicate(doc(node))(row)

Test.describe("AST v1 — operator semantics (AST-O)", () => {
    Test.it("AST-O01 the v1 operator set is exactly these 13, frozen", () => {
        assert.deepEqual(
            [...AST.OPERATORS].sort(),
            ["between", "eq", "gt", "gte", "in", "isnull", "like", "lt", "lte", "ne", "nin", "nlike", "notnull"]
        )
        assert.truthy(Object.isFrozen(AST.OPERATORS), "OPERATORS must be frozen")
    })

    Test.it("AST-O02 eq is strict — no type coercion", () => {
        assert.equal(match(leaf("tier", "eq", "gold"), { tier: "gold" }), true)
        assert.equal(match(leaf("age", "eq", 1), { age: "1" }), false)
        assert.equal(match(leaf("age", "eq", "1"), { age: 1 }), false)
        assert.equal(match(leaf("active", "eq", true), { active: 1 }), false)
    })

    Test.it("AST-O03 ne matches differing non-null values", () => {
        assert.equal(match(leaf("tier", "ne", "gold"), { tier: "silver" }), true)
        assert.equal(match(leaf("tier", "ne", "gold"), { tier: "gold" }), false)
    })

    Test.it("AST-O04 gt/gte/lt/lte compare numbers numerically", () => {
        assert.equal(match(leaf("age", "gt", 18), { age: 19 }), true)
        assert.equal(match(leaf("age", "gt", 18), { age: 18 }), false)
        assert.equal(match(leaf("age", "gte", 18), { age: 18 }), true)
        assert.equal(match(leaf("age", "lt", 18), { age: 17 }), true)
        assert.equal(match(leaf("age", "lte", 18), { age: 18 }), true)
        assert.equal(match(leaf("age", "lte", 18), { age: 19 }), false)
    })

    Test.it("AST-O05 ordering on strings is by code unit — ISO dates order correctly", () => {
        assert.equal(match(leaf("created", "gte", "2026-01-01"), { created: "2026-06-15" }), true)
        assert.equal(match(leaf("created", "lt", "2026-01-01"), { created: "2025-12-31" }), true)
        assert.equal(match(leaf("name", "gt", "alice"), { name: "bob" }), true)
    })

    Test.it("AST-O06 cross-type ordering never matches", () => {
        assert.equal(match(leaf("age", "gt", 18), { age: "19" }), false)
        assert.equal(match(leaf("name", "gt", "a"), { name: 5 }), false)
    })

    Test.it("AST-O07 boolean eq/ne", () => {
        assert.equal(match(leaf("active", "eq", true), { active: true }), true)
        assert.equal(match(leaf("active", "ne", true), { active: false }), true)
    })

    Test.it("AST-O08 in matches membership strictly; nin is its complement on non-null", () => {
        assert.equal(match(leaf("tier", "in", ["gold", "silver"]), { tier: "gold" }), true)
        assert.equal(match(leaf("tier", "in", ["gold", "silver"]), { tier: "bronze" }), false)
        assert.equal(match(leaf("age", "in", [1, 2]), { age: "1" }), false)
        assert.equal(match(leaf("tier", "nin", ["gold"]), { tier: "silver" }), true)
        assert.equal(match(leaf("tier", "nin", ["gold"]), { tier: "gold" }), false)
    })

    Test.it("AST-O09 like: % matches any run including empty", () => {
        assert.equal(match(leaf("name", "like", "%li%"), { name: "alice" }), true)
        assert.equal(match(leaf("name", "like", "a%"), { name: "alice" }), true)
        assert.equal(match(leaf("name", "like", "%e"), { name: "alice" }), true)
        assert.equal(match(leaf("name", "like", "%"), { name: "" }), true)
        assert.equal(match(leaf("name", "like", "b%"), { name: "alice" }), false)
    })

    Test.it("AST-O10 like: _ matches exactly one character", () => {
        assert.equal(match(leaf("name", "like", "_ob"), { name: "bob" }), true)
        assert.equal(match(leaf("name", "like", "_ob"), { name: "blob" }), false)
    })

    Test.it("AST-O11 like is anchored — whole-value match", () => {
        assert.equal(match(leaf("name", "like", "li"), { name: "alice" }), false)
        assert.equal(match(leaf("name", "like", "alice"), { name: "alice" }), true)
    })

    Test.it("AST-O12 like is case-insensitive for ASCII", () => {
        assert.equal(match(leaf("name", "like", "ALICE"), { name: "alice" }), true)
        assert.equal(match(leaf("name", "like", "%LI%"), { name: "aLiCe" }), true)
    })

    Test.it("AST-O13 like: backslash escapes % _ and backslash", () => {
        assert.equal(match(leaf("s", "like", "100\\%"), { s: "100%" }), true)
        assert.equal(match(leaf("s", "like", "100\\%"), { s: "1000" }), false)
        assert.equal(match(leaf("s", "like", "a\\_b"), { s: "a_b" }), true)
        assert.equal(match(leaf("s", "like", "a\\_b"), { s: "axb" }), false)
        assert.equal(match(leaf("s", "like", "c:\\\\%"), { s: "c:\\temp" }), true)
    })

    Test.it("AST-O14 like treats regex metacharacters as literals", () => {
        assert.equal(match(leaf("s", "like", "a.c"), { s: "a.c" }), true)
        assert.equal(match(leaf("s", "like", "a.c"), { s: "abc" }), false)
        assert.equal(match(leaf("s", "like", "(x)%"), { s: "(x) marks" }), true)
    })

    Test.it("AST-O15 nlike is the complement of like on non-null values", () => {
        assert.equal(match(leaf("name", "nlike", "b%"), { name: "alice" }), true)
        assert.equal(match(leaf("name", "nlike", "a%"), { name: "alice" }), false)
    })

    Test.it("AST-O16 isnull matches null and missing fields; notnull the opposite", () => {
        assert.equal(match(leaf("tier", "isnull"), { tier: null }), true)
        assert.equal(match(leaf("tier", "isnull"), {}), true)
        assert.equal(match(leaf("tier", "isnull"), { tier: "gold" }), false)
        assert.equal(match(leaf("tier", "notnull"), { tier: "gold" }), true)
        assert.equal(match(leaf("tier", "notnull"), { tier: null }), false)
        assert.equal(match(leaf("tier", "notnull"), {}), false)
    })

    Test.it("AST-O17 SQL null semantics — every comparison on null/missing is false", () => {
        for (const op of ["eq", "gt", "gte", "lt", "lte"]) {
            assert.equal(match(leaf("age", op, 18), { age: null }), false, `${op} on null`)
            assert.equal(match(leaf("age", op, 18), {}), false, `${op} on missing`)
        }
        assert.equal(match(leaf("age", "between", [1, 99]), { age: null }), false)
        assert.equal(match(leaf("name", "like", "%"), { name: null }), false)
    })

    Test.it("AST-O18 SQL null semantics extend to negative operators — ne/nin/nlike on null are false", () => {
        assert.equal(match(leaf("tier", "ne", "gold"), { tier: null }), false)
        assert.equal(match(leaf("tier", "ne", "gold"), {}), false)
        assert.equal(match(leaf("tier", "nin", ["gold"]), { tier: null }), false)
        assert.equal(match(leaf("name", "nlike", "b%"), { name: null }), false)
    })

    Test.it("AST-O19 between is inclusive of both bounds", () => {
        assert.equal(match(leaf("age", "between", [18, 65]), { age: 18 }), true)
        assert.equal(match(leaf("age", "between", [18, 65]), { age: 65 }), true)
        assert.equal(match(leaf("age", "between", [18, 65]), { age: 17 }), false)
        assert.equal(match(leaf("age", "between", [18, 65]), { age: 66 }), false)
    })
})
