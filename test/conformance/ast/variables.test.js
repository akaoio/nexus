/**
 * Query AST v1 conformance — DYNAMIC VARIABLES (AST-V).
 *
 * Defines resolve(): dynamic variables become literals BEFORE any compile
 * target sees the document (ARCHITECTURE.md §4.2 invariant 3 — compilers only
 * ever see static values).
 *
 * Spec decisions encoded here:
 *  - v1 variables: $CURRENT_USER, $CURRENT_ROLES, $NOW, $NOW(<±n><unit>)
 *    with units s m h d.
 *  - A value is a variable only if the ENTIRE string matches the variable
 *    pattern — strings merely containing "$" are literals (no injection).
 *  - resolve(doc, context) is pure (input untouched) and idempotent.
 *  - context.now is an ISO-8601 string (injected clock — resolution is
 *    deterministic and testable; there is no hidden wall-clock read).
 *  - Variables resolve element-wise inside array values.
 *  - Unknown $-pattern variables throw E_UNKNOWN_VAR; a variable whose
 *    context key is absent throws E_MISSING_CONTEXT.
 *  - predicate() on a document that still contains variables throws
 *    E_UNRESOLVED.
 */

import Test, { assert } from "../../../src/kernel/Test.js"
import AST from "./_load.js"
import { doc, leaf, and } from "./_helpers.js"

const CTX = {
    user: "u1",
    roles: ["admin", "sales"],
    now: "2026-07-15T00:00:00.000Z"
}

Test.describe("AST v1 — dynamic variables (AST-V)", () => {
    Test.it("AST-V01 $CURRENT_USER resolves to context.user", () => {
        const resolved = AST.resolve(doc(leaf("owner", "eq", "$CURRENT_USER")), CTX)
        assert.equal(resolved.root.value, "u1")
    })

    Test.it("AST-V02 $CURRENT_ROLES resolves to the roles array (for in/nin)", () => {
        const resolved = AST.resolve(doc(leaf("role", "in", "$CURRENT_ROLES")), CTX)
        assert.deepEqual(resolved.root.value, ["admin", "sales"])
    })

    Test.it("AST-V03 $NOW resolves to context.now exactly", () => {
        const resolved = AST.resolve(doc(leaf("created", "lte", "$NOW")), CTX)
        assert.equal(resolved.root.value, "2026-07-15T00:00:00.000Z")
    })

    Test.it("AST-V04 $NOW(-30d) shifts the injected clock backwards", () => {
        const resolved = AST.resolve(doc(leaf("created", "gte", "$NOW(-30d)")), CTX)
        assert.equal(resolved.root.value, "2026-06-15T00:00:00.000Z")
    })

    Test.it("AST-V05 $NOW offsets support +/- and units s m h d", () => {
        const cases = [
            ["$NOW(+1h)", "2026-07-15T01:00:00.000Z"],
            ["$NOW(-90s)", "2026-07-14T23:58:30.000Z"],
            ["$NOW(+15m)", "2026-07-15T00:15:00.000Z"],
            ["$NOW(-1d)", "2026-07-14T00:00:00.000Z"]
        ]
        for (const [expr, expected] of cases) {
            const resolved = AST.resolve(doc(leaf("t", "gte", expr)), CTX)
            assert.equal(resolved.root.value, expected)
        }
    })

    Test.it("AST-V06 resolve is pure — the input document is not mutated", () => {
        const input = doc(leaf("owner", "eq", "$CURRENT_USER"))
        const snapshot = JSON.stringify(input)
        AST.resolve(input, CTX)
        assert.equal(JSON.stringify(input), snapshot)
    })

    Test.it("AST-V07 resolve is idempotent", () => {
        const once = AST.resolve(doc(leaf("owner", "eq", "$CURRENT_USER")), CTX)
        const twice = AST.resolve(once, CTX)
        assert.deepEqual(twice, once)
    })

    Test.it("AST-V08 strings merely containing $ are literals — no partial substitution", () => {
        for (const literal of ["price is $CURRENT_USD", "a$NOWb", "$now", "$$CURRENT_USER"]) {
            const resolved = AST.resolve(doc(leaf("s", "eq", literal)), CTX)
            assert.equal(resolved.root.value, literal)
        }
    })

    Test.it("AST-V09 variables resolve element-wise inside array values", () => {
        const resolved = AST.resolve(doc(leaf("owner", "in", ["u9", "$CURRENT_USER"])), CTX)
        assert.deepEqual(resolved.root.value, ["u9", "u1"])
    })

    Test.it("AST-V10 unknown variables throw E_UNKNOWN_VAR", () => {
        assert.throws(() => AST.resolve(doc(leaf("x", "eq", "$WHATEVER")), CTX), "E_UNKNOWN_VAR")
    })

    Test.it("AST-V11 a known variable with missing context throws E_MISSING_CONTEXT", () => {
        assert.throws(() => AST.resolve(doc(leaf("owner", "eq", "$CURRENT_USER")), {}), "E_MISSING_CONTEXT")
    })

    Test.it("AST-V12 predicate() refuses unresolved documents with E_UNRESOLVED", () => {
        assert.throws(() => AST.predicate(doc(leaf("owner", "eq", "$CURRENT_USER"))), "E_UNRESOLVED")
        assert.throws(
            () => AST.predicate(doc(and(leaf("a", "eq", 1), leaf("t", "gte", "$NOW")))),
            "E_UNRESOLVED"
        )
    })

    Test.it("AST-V13 resolution reaches variables at any nesting depth", () => {
        let node = leaf("owner", "eq", "$CURRENT_USER")
        for (let i = 0; i < 20; i++) node = and(node)
        let probe = AST.resolve(doc(node), CTX).root
        for (let i = 0; i < 20; i++) probe = probe.children[0]
        assert.equal(probe.value, "u1")
    })
})
