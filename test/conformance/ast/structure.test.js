/**
 * Query AST v1 conformance — STRUCTURE (AST-S).
 *
 * Defines the document envelope and node-shape invariants of ARCHITECTURE.md
 * §4.2. Clause numbers are immutable: a clause is never renumbered or changed
 * in meaning within astVersion 1 — evolution happens in a new astVersion.
 *
 * Spec decisions encoded here:
 *  - Document envelope: { astVersion: 1, root: <node|null> }; root null = match all.
 *  - A node is EITHER logic { op, children } OR leaf { field, operator[, value] } — never both.
 *  - Logic ops: and | or | not. and/or take ≥1 child; not takes exactly 1.
 *  - Nesting depth of logic nodes is UNLIMITED (the Nexus differentiator).
 *  - Field paths: /^[a-z][a-z0-9_]*$/ segments joined by "." — max 3 relation
 *    hops by default (validate option maxDepth overrides).
 *  - Unknown keys on any node are errors: the format is frozen; new keys need
 *    a new astVersion (principle N4).
 *  - validate() never throws; it returns { valid } or { valid, errors: [{code, path}] }
 *    where path is a JSON-pointer to the offending node.
 */

import Test, { assert } from "../../../src/kernel/Test.js"
import AST from "./_load.js"
import { doc, leaf, and, or, not, hasError } from "./_helpers.js"

Test.describe("AST v1 — structure (AST-S)", () => {
    Test.it("AST-S01 a valid document is an object with astVersion 1 and a root node", () => {
        const result = AST.validate(doc(leaf("tier", "eq", "gold")))
        assert.equal(result.valid, true)
    })

    Test.it("AST-S02 root null is valid and means match-all", () => {
        assert.equal(AST.validate(doc(null)).valid, true)
    })

    Test.it("AST-S03 a logic node has op and children", () => {
        const result = AST.validate(doc(and(leaf("tier", "eq", "gold"), leaf("age", "gt", 18))))
        assert.equal(result.valid, true)
    })

    Test.it("AST-S04 a leaf node has field, operator and value", () => {
        assert.equal(AST.validate(doc(leaf("age", "gte", 21))).valid, true)
    })

    Test.it("AST-S05 a node with both op and field is E_HYBRID_NODE", () => {
        const bad = { op: "and", field: "tier", operator: "eq", value: "x", children: [] }
        assert.truthy(hasError(AST.validate(doc(bad)), "E_HYBRID_NODE"))
    })

    Test.it("AST-S06 a node with neither op nor field is E_NODE_SHAPE", () => {
        assert.truthy(hasError(AST.validate(doc({ hello: "world" })), "E_NODE_SHAPE"))
    })

    Test.it("AST-S07 and/or with zero children is E_EMPTY_CHILDREN", () => {
        assert.truthy(hasError(AST.validate(doc({ op: "and", children: [] })), "E_EMPTY_CHILDREN"))
        assert.truthy(hasError(AST.validate(doc({ op: "or", children: [] })), "E_EMPTY_CHILDREN"))
    })

    Test.it("AST-S08 not with other than exactly one child is E_NOT_ARITY", () => {
        const two = { op: "not", children: [leaf("a", "eq", 1), leaf("b", "eq", 2)] }
        assert.truthy(hasError(AST.validate(doc(two)), "E_NOT_ARITY"))
        assert.truthy(hasError(AST.validate(doc({ op: "not", children: [] })), "E_NOT_ARITY"))
    })

    Test.it("AST-S09 unknown logic op is E_UNKNOWN_LOGIC", () => {
        const bad = { op: "xor", children: [leaf("a", "eq", 1)] }
        assert.truthy(hasError(AST.validate(doc(bad)), "E_UNKNOWN_LOGIC"))
    })

    Test.it("AST-S10 unknown leaf operator is E_UNKNOWN_OPERATOR", () => {
        assert.truthy(hasError(AST.validate(doc(leaf("tier", "equals", "gold"))), "E_UNKNOWN_OPERATOR"))
    })

    Test.it("AST-S11 field segments must match /^[a-z][a-z0-9_]*$/ — else E_FIELD_NAME", () => {
        assert.truthy(hasError(AST.validate(doc(leaf("Tier", "eq", "x"))), "E_FIELD_NAME"))
        assert.truthy(hasError(AST.validate(doc(leaf("1st", "eq", "x"))), "E_FIELD_NAME"))
        assert.truthy(hasError(AST.validate(doc(leaf("a..b", "eq", "x"))), "E_FIELD_NAME"))
        assert.truthy(hasError(AST.validate(doc(leaf("drop table;", "eq", "x"))), "E_FIELD_NAME"))
        assert.equal(AST.validate(doc(leaf("contact_2.email", "eq", "x"))).valid, true)
    })

    Test.it("AST-S12 relation path deeper than 3 hops is E_PATH_DEPTH by default; maxDepth option overrides", () => {
        const deep = leaf("a.b.c.d.e", "eq", 1) // 4 hops
        assert.truthy(hasError(AST.validate(doc(deep)), "E_PATH_DEPTH"))
        assert.equal(AST.validate(doc(leaf("a.b.c.d", "eq", 1))).valid, true) // 3 hops
        assert.equal(AST.validate(doc(deep), { maxDepth: 4 }).valid, true)
    })

    Test.it("AST-S13 logic nesting depth is UNLIMITED — 100 levels validate cleanly", () => {
        let node = leaf("age", "gt", 0)
        for (let i = 0; i < 100; i++) node = i % 2 ? and(node) : or(node, leaf("tier", "eq", "gold"))
        assert.equal(AST.validate(doc(node)).valid, true)
    })

    Test.it("AST-S14 unknown keys on a node are E_NODE_KEYS (frozen format)", () => {
        const extraLeaf = { field: "tier", operator: "eq", value: "x", comment: "hi" }
        assert.truthy(hasError(AST.validate(doc(extraLeaf)), "E_NODE_KEYS"))
        const extraLogic = { op: "and", children: [leaf("a", "eq", 1)], label: "hi" }
        assert.truthy(hasError(AST.validate(doc(extraLogic)), "E_NODE_KEYS"))
    })

    Test.it("AST-S15 errors carry a JSON-pointer path to the offending node", () => {
        const bad = and(leaf("tier", "eq", "gold"), { hello: "world" })
        const result = AST.validate(doc(bad))
        assert.equal(result.valid, false)
        assert.equal(result.errors[0].path, "/root/children/1")
    })

    Test.it("AST-S16 scalar operator values must be string|number|boolean — else E_VALUE_TYPE", () => {
        assert.truthy(hasError(AST.validate(doc(leaf("tier", "eq", { a: 1 }))), "E_VALUE_TYPE"))
        assert.truthy(hasError(AST.validate(doc(leaf("tier", "eq", [1]))), "E_VALUE_TYPE"))
    })

    Test.it("AST-S17 isnull/notnull must not carry a value — else E_VALUE_FORBIDDEN", () => {
        const bad = { field: "tier", operator: "isnull", value: true }
        assert.truthy(hasError(AST.validate(doc(bad)), "E_VALUE_FORBIDDEN"))
        assert.equal(AST.validate(doc(leaf("tier", "isnull"))).valid, true)
    })

    Test.it("AST-S18 in/nin require a non-empty array of scalars", () => {
        assert.truthy(hasError(AST.validate(doc(leaf("tier", "in", "gold"))), "E_VALUE_TYPE"))
        assert.truthy(hasError(AST.validate(doc(leaf("tier", "in", []))), "E_VALUE_EMPTY"))
        assert.truthy(hasError(AST.validate(doc(leaf("tier", "in", [{}]))), "E_VALUE_TYPE"))
        assert.equal(AST.validate(doc(leaf("tier", "in", ["gold", "silver"]))).valid, true)
    })

    Test.it("AST-S19 between requires exactly [min, max]", () => {
        assert.truthy(hasError(AST.validate(doc(leaf("age", "between", [1]))), "E_VALUE_TYPE"))
        assert.truthy(hasError(AST.validate(doc(leaf("age", "between", [1, 2, 3]))), "E_VALUE_TYPE"))
        assert.equal(AST.validate(doc(leaf("age", "between", [18, 65]))).valid, true)
    })

    Test.it("AST-S20 null as a comparison value is E_NULL_VALUE — use isnull/notnull", () => {
        assert.truthy(hasError(AST.validate(doc(leaf("tier", "eq", null))), "E_NULL_VALUE"))
        assert.truthy(hasError(AST.validate(doc(leaf("tier", "in", ["a", null]))), "E_NULL_VALUE"))
    })

    Test.it("AST-S21 validate never throws — even on garbage input", () => {
        for (const garbage of [undefined, null, 42, "hi", [], { astVersion: 1 }, { root: null }]) {
            const result = AST.validate(garbage)
            assert.equal(typeof result.valid, "boolean")
        }
    })
})
