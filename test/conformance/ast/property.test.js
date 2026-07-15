/**
 * Query AST v1 conformance — PROPERTY-BASED INVARIANTS (AST-Q).
 *
 * Algebraic laws that must hold over RANDOM documents and rows, not just
 * hand-picked fixtures. Uses a seeded PRNG — failures are reproducible.
 * These are the invariants the ARCHITECTURE.md test pyramid names as the
 * bridge between compile targets: when the SQL targets land (Phase 2), the
 * same generators drive SQL ≡ predicate equivalence on real engines.
 */

import Test, { assert } from "../../../src/kernel/Test.js"
import AST from "./_load.js"
import { doc, not, and, or, prng, randomNode, randomRow, filter } from "./_helpers.js"

const DOCS = 150
const ROWS_PER_DOC = 25

Test.describe("AST v1 — property invariants (AST-Q)", () => {
    Test.it("AST-Q01 every generated document validates (generator sanity)", () => {
        const rnd = prng(0xa11ce)
        for (let i = 0; i < DOCS; i++) {
            const d = doc(randomNode(rnd))
            const result = AST.validate(d)
            assert.truthy(result.valid, `seed doc #${i} failed: ${JSON.stringify(result.errors)}`)
        }
    })

    Test.it("AST-Q02 predicates are total over random documents × random rows", () => {
        const rnd = prng(0xb0b)
        for (let i = 0; i < DOCS; i++) {
            const p = AST.predicate(doc(randomNode(rnd)))
            for (let j = 0; j < ROWS_PER_DOC; j++) {
                assert.equal(typeof p(randomRow(rnd)), "boolean")
            }
        }
    })

    Test.it("AST-Q03 double negation: not(not(x)) ≡ x on every row", () => {
        const rnd = prng(0xdead)
        for (let i = 0; i < DOCS; i++) {
            const x = randomNode(rnd)
            const p = AST.predicate(doc(x))
            const pp = AST.predicate(doc(not(not(x))))
            for (let j = 0; j < ROWS_PER_DOC; j++) {
                const row = randomRow(rnd)
                assert.equal(pp(row), p(row), `double negation diverged on ${JSON.stringify(row)}`)
            }
        }
    })

    Test.it("AST-Q04 De Morgan: not(and(a,b)) ≡ or(not(a), not(b))", () => {
        const rnd = prng(0xf00d)
        for (let i = 0; i < DOCS; i++) {
            const a = randomNode(rnd, 2)
            const b = randomNode(rnd, 2)
            const lhs = AST.predicate(doc(not(and(a, b))))
            const rhs = AST.predicate(doc(or(not(a), not(b))))
            for (let j = 0; j < ROWS_PER_DOC; j++) {
                const row = randomRow(rnd)
                assert.equal(lhs(row), rhs(row), `De Morgan diverged on ${JSON.stringify(row)}`)
            }
        }
    })

    Test.it("AST-Q05 child order of and/or never changes results", () => {
        const rnd = prng(0xcafe)
        for (let i = 0; i < DOCS; i++) {
            const a = randomNode(rnd, 2)
            const b = randomNode(rnd, 2)
            const c = randomNode(rnd, 2)
            for (const op of [and, or]) {
                const fwd = AST.predicate(doc(op(a, b, c)))
                const rev = AST.predicate(doc(op(c, a, b)))
                for (let j = 0; j < 10; j++) {
                    const row = randomRow(rnd)
                    assert.equal(fwd(row), rev(row), `${op === and ? "and" : "or"} order sensitivity`)
                }
            }
        }
    })

    Test.it("AST-Q06 SECURITY: inject() narrows on random queries × random permissions", () => {
        const rnd = prng(0x5ec)
        const dataset = []
        for (let i = 0; i < 200; i++) dataset.push(randomRow(rnd))
        for (let i = 0; i < DOCS; i++) {
            const q = doc(randomNode(rnd, 3))
            const perm = doc(randomNode(rnd, 2))
            const base = new Set(filter(AST.predicate(q), dataset).map((r) => JSON.stringify(r)))
            const permitted = new Set(filter(AST.predicate(perm), dataset).map((r) => JSON.stringify(r)))
            const injected = filter(AST.predicate(AST.inject(q, perm)), dataset)
            for (const row of injected) {
                const key = JSON.stringify(row)
                assert.truthy(base.has(key) && permitted.has(key), "injection widened the result set")
            }
        }
    })
})
