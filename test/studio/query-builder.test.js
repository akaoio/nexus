/**
 * Studio conformance — <nx-query-builder> (NXQ-*).
 *
 * The pure helpers are pinned in Node (operator sets, normalize/prune with
 * PREDICATE-EQUIVALENCE proofs); the recursive DOM behavior is pinned in the
 * browser conformance run — including a seeded UI-action fuzz where every
 * reachable editor state must produce a VALID AST document, and a 10-level
 * nesting built with real clicks.
 */

import Test, { assert } from "../../src/kernel/Test.js"
import * as AST from "../../src/ast/AST.js"
import { FIELD_TYPES } from "../../src/model/Model.js"
import {
    OPERATORS_BY_TYPE,
    emptyCondition,
    defaultValue,
    activeFilter,
    normalize,
    prune,
    NxQueryBuilder
} from "../../src/studio/query-builder.js"
import { doc, leaf, and, or, not, prng, ROWS } from "../conformance/ast/_helpers.js"
import { schema, field } from "../conformance/model/_helpers.js"

const TASK = schema({
    name: "task",
    fields: [
        field("title", "text", { required: true }),
        field("done", "boolean", { default: false }),
        field("priority", "select", { options: ["low", "medium", "high"] }),
        field("points", "integer")
    ]
})

const sameResults = (a, b) => {
    const pa = AST.predicate(a)
    const pb = AST.predicate(b)
    for (const row of ROWS) assert.equal(pa(row), pb(row), `diverged on ${JSON.stringify(row)}`)
}

Test.describe("Studio — query-builder helpers (NXQ)", () => {
    Test.it("NXQ-01 every offered operator is in the closed AST set; every field type is covered", () => {
        for (const [type, operators] of Object.entries(OPERATORS_BY_TYPE))
            for (const op of operators) assert.truthy(AST.OPERATORS.includes(op), `${type}:${op}`)
        for (const type of FIELD_TYPES)
            if (type !== "table") assert.truthy(OPERATORS_BY_TYPE[type], `type ${type} must offer operators`)
    })

    Test.it("NXQ-02 emptyCondition yields a valid document for any schema", () => {
        const empty = emptyCondition(TASK)
        assert.equal(AST.validate(doc(and(empty))).valid, true)
        assert.equal(empty.field, "title")
        assert.equal(defaultValue(field("x", "boolean")), true)
        assert.equal(defaultValue(field("x", "select", { options: ["a", "b"] })), "a")
        assert.equal(defaultValue(field("x", "integer")), 0)
        // Even a schema with zero declared fields falls back to system fields
        const bare = emptyCondition(schema({ fields: [] }))
        assert.equal(bare.field, "id")
    })

    Test.it("NXQ-03 prune removes empty groups bottom-up; an emptied root becomes null", () => {
        const messy = and(leaf("age", "gt", 1), or(and()), not(and()))
        const pruned = prune(messy)
        assert.deepEqual(pruned, { op: "and", children: [leaf("age", "gt", 1)] })
        assert.equal(AST.validate(doc(pruned)).valid, true)
        assert.equal(prune(and(or(), not(and()))), null)
        assert.deepEqual(prune(leaf("a", "eq", 1)), leaf("a", "eq", 1))
    })

    Test.it("NXQ-04 normalize folds not-chains and wraps not(leaf) — SEMANTICALLY identical", () => {
        const l = leaf("tier", "eq", "gold")
        // not(not(x)) → x
        const folded = normalize(not(not(l)))
        assert.deepEqual(folded, l)
        // not(leaf) → not(and(leaf))
        const wrapped = normalize(not(l))
        assert.deepEqual(wrapped, { op: "not", children: [{ op: "and", children: [l] }] })
        sameResults(doc(not(l)), doc(wrapped))
        // triple not ≡ single not
        sameResults(doc(not(not(not(l)))), doc(normalize(not(not(not(l))))))
        // documents without nots pass through structurally intact
        const plain = and(l, or(leaf("age", "gt", 1), and(leaf("owner", "eq", "u1"))))
        assert.deepEqual(normalize(plain), plain)
    })

    Test.it("NXQ-05 the module is importable in Node — classes defined, registration browser-only", () => {
        assert.equal(typeof NxQueryBuilder, "function")
    })
})

// ─── Browser: the recursive editor ────────────────────────────────────────────

/** Collect every nested group/condition through the shadow trees. */
function collect(builder, selector) {
    const out = []
    const walk = (host) => {
        if (!host.shadowRoot) return
        for (const el of host.shadowRoot.querySelectorAll("nx-query-group, nx-query-condition")) {
            if (el.matches(selector)) out.push(el)
            walk(el)
        }
    }
    walk(builder)
    return out
}

const groupsOf = (builder) => collect(builder, "nx-query-group")
const conditionsOf = (builder) => collect(builder, "nx-query-condition")

function mountBuilder(value) {
    const builder = document.createElement("nx-query-builder")
    builder.schema = TASK
    if (value) builder.value = value
    let last = null
    builder.addEventListener("change", (e) => (last = e.detail))
    document.body.appendChild(builder)
    return { builder, lastChange: () => last }
}

const setInput = (el, value) => {
    el.value = value
    el.dispatchEvent(new Event("input"))
}
const setSelect = (el, value) => {
    el.value = value
    el.dispatchEvent(new Event("change"))
}

Test.describe("Studio — <nx-query-builder> (NXQ, browser)", () => {
    Test.it("NXQ-10 empty state mounts; adding the first condition emits a valid document", () => {
        const { builder, lastChange } = mountBuilder()
        assert.deepEqual(builder.value, { astVersion: 1, root: null })
        builder.shadowRoot.querySelector(".add-condition").click()
        const change = lastChange()
        assert.equal(change.valid, true)
        assert.deepEqual(change.value.root, { op: "and", children: [{ field: "title", operator: "eq", value: "" }] })
        builder.remove()
    })

    Test.it("NXQ-11 a nested document renders recursive groups and round-trips byte-identically", () => {
        const document_ = doc(
            and(
                leaf("title", "eq", "x"),
                or(leaf("points", "gt", 3), and(leaf("done", "eq", true)))
            )
        )
        const { builder } = mountBuilder(document_)
        assert.equal(groupsOf(builder).length, 3) // and → or → and: the component recursed
        assert.equal(conditionsOf(builder).length, 3)
        assert.deepEqual(builder.value, document_) // no nots → exact round-trip
        builder.remove()
    })

    Test.it("NXQ-12 field switches retarget the operator list; isnull drops the value input", () => {
        const { builder, lastChange } = mountBuilder(doc(and(leaf("title", "eq", "x"))))
        const row = conditionsOf(builder)[0]
        setSelect(row.shadowRoot.querySelector(".field"), "priority")
        const operators = [...row.shadowRoot.querySelector(".operator").options].map((o) => o.value)
        assert.truthy(operators.includes("in") && !operators.includes("gt"))
        assert.truthy(row.shadowRoot.querySelector("select.value"), "select field renders an options dropdown")
        setSelect(row.shadowRoot.querySelector(".operator"), "isnull")
        assert.equal(row.shadowRoot.querySelector(".value"), null)
        assert.equal(lastChange().valid, true)
        assert.deepEqual(lastChange().value.root.children[0], { field: "priority", operator: "isnull" })
        builder.remove()
    })

    Test.it("NXQ-18 Frappe-informed: dates open as between, numbers empty; activeFilter drops PENDING conditions", () => {
        // fresh date conditions open as a range; fresh numerics start empty (pending)
        assert.deepEqual(emptyCondition(schema({ fields: [field("when", "date")] })).operator, "between")
        assert.equal(emptyCondition(schema({ fields: [field("n", "integer")] })).value, "")
        // pending (empty-valued) conditions do not constrain the query at all
        assert.equal(activeFilter({ op: "and", children: [{ field: "title", operator: "like", value: "" }] }), null)
        // once a value exists the condition bites — and like auto-wraps %…%
        assert.deepEqual(
            activeFilter({ op: "and", children: [{ field: "title", operator: "like", value: "ship" }] }),
            { op: "and", children: [{ field: "title", operator: "like", value: "%ship%" }] }
        )
        // between waits for BOTH bounds; in waits for at least one entry
        assert.equal(activeFilter({ field: "points", operator: "between", value: ["", ""] }), null)
        assert.equal(activeFilter({ field: "points", operator: "between", value: [1, ""] }), null)
        assert.deepEqual(activeFilter({ field: "points", operator: "between", value: [1, 5] }), { field: "points", operator: "between", value: [1, 5] })
        // valueless operators are always active; groups prune bottom-up
        assert.deepEqual(activeFilter({ field: "title", operator: "isnull" }), { field: "title", operator: "isnull" })
        assert.equal(activeFilter({ op: "not", children: [{ op: "or", children: [{ field: "title", operator: "like", value: "" }] }] }), null)
    })

    Test.it("NXQ-13 groups nest by click and prune cascades on removal", () => {
        const { builder } = mountBuilder(doc(and(leaf("title", "eq", "x"))))
        groupsOf(builder)[0].shadowRoot.querySelector(".add-group").click()
        let inner = groupsOf(builder)[1]
        assert.truthy(inner, "a nested group appeared")
        // Removing the nested group's only condition prunes the group itself
        const innerCondition = collect(inner, "nx-query-condition")[0]
        innerCondition.shadowRoot.querySelector(".remove").click()
        assert.equal(groupsOf(builder).length, 1, "the emptied group was pruned")
        assert.equal(AST.validate(builder.value).valid, true)
        builder.remove()
    })

    Test.it("NXQ-14 the NOT toggle wraps the group and flips predicate results", () => {
        const base = doc(and(leaf("done", "eq", true)))
        const { builder, lastChange } = mountBuilder(base)
        const box = groupsOf(builder)[0].shadowRoot.querySelector(".negate-box")
        box.checked = true
        box.dispatchEvent(new Event("change"))
        const negated = lastChange().value
        assert.equal(negated.root.op, "not")
        const rows = [{ done: true }, { done: false }, {}]
        for (const row of rows)
            assert.equal(AST.predicate(negated)(row), !AST.predicate(base)(row), JSON.stringify(row))
        // untoggle → back to the plain group
        const box2 = groupsOf(builder)[0].shadowRoot.querySelector(".negate-box")
        box2.checked = false
        box2.dispatchEvent(new Event("change"))
        assert.deepEqual(lastChange().value, base)
        builder.remove()
    })

    Test.it("NXQ-15 typed value editors: integer in-lists parse numbers; between takes two bounds", () => {
        const { builder, lastChange } = mountBuilder(doc(and(leaf("points", "eq", 0))))
        const row = () => conditionsOf(builder)[0]
        setSelect(row().shadowRoot.querySelector(".operator"), "in")
        setInput(row().shadowRoot.querySelector(".value"), "1, 2, 3")
        assert.deepEqual(lastChange().value.root.children[0].value, [1, 2, 3])
        setSelect(row().shadowRoot.querySelector(".operator"), "between")
        const bounds = row().shadowRoot.querySelectorAll(".value")
        assert.equal(bounds.length, 2)
        setInput(bounds[0], "5")
        setInput(bounds[1], "9")
        assert.deepEqual(lastChange().value.root.children[0].value, [5, 9])
        assert.equal(lastChange().valid, true)
        builder.remove()
    })

    Test.it("NXQ-16 FUZZ: every reachable editor state is a valid document (seeded UI actions)", () => {
        const rnd = prng(0xf1172)
        const { builder } = mountBuilder(doc(and(leaf("title", "eq", "seed"))))
        const pick = (list) => list[Math.floor(rnd() * list.length)]
        for (let i = 0; i < 60; i++) {
            const groups = groupsOf(builder)
            if (!groups.length) {
                builder.shadowRoot.querySelector(".add-condition").click()
                continue
            }
            const group = pick(groups)
            const action = Math.floor(rnd() * 5)
            if (action === 0) group.shadowRoot.querySelector(".add-condition").click()
            else if (action === 1) group.shadowRoot.querySelector(".add-group").click()
            else if (action === 2) {
                const box = group.shadowRoot.querySelector(".negate-box")
                box.checked = !box.checked
                box.dispatchEvent(new Event("change"))
            } else if (action === 3) setSelect(group.shadowRoot.querySelector(".op"), rnd() < 0.5 ? "and" : "or")
            else {
                const conditions = conditionsOf(builder)
                if (conditions.length) pick(conditions).shadowRoot.querySelector(".remove").click()
            }
            const result = AST.validate(builder.value)
            assert.truthy(result.valid, `action #${i} broke the document: ${JSON.stringify(result.errors)}`)
        }
        builder.remove()
    })

    Test.it("NXQ-17 ten levels of nesting by real clicks — unlimited depth is structural", () => {
        const { builder } = mountBuilder(doc(and(leaf("title", "eq", "deep"))))
        for (let depth = 0; depth < 9; depth++) {
            const deepest = groupsOf(builder).at(-1)
            deepest.shadowRoot.querySelector(".add-group").click()
        }
        assert.equal(groupsOf(builder).length, 10)
        const value = builder.value
        assert.equal(AST.validate(value).valid, true)
        let node = value.root
        let measured = 0
        while (node && node.op) {
            measured++
            node = node.children.find((c) => c.op)
        }
        assert.equal(measured, 10)
        builder.remove()
    })
}, { browser: true })
