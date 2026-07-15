/**
 * Nexus test entry point.
 *
 * Usage:
 *   npm test              # run everything
 *   node test.js ast      # run suites whose name matches "ast"
 *
 * Phase 0 status: the conformance suites below ARE the spec for Query AST v1.
 * They are expected to be fully red until the implementation lands (Phase 2).
 */

import Test from "./src/kernel/Test.js"

// Conformance — Query AST v1 (clauses AST-S/O/V/P/I/N/Q)
import "./test/conformance/ast/structure.test.js"
import "./test/conformance/ast/operators.test.js"
import "./test/conformance/ast/variables.test.js"
import "./test/conformance/ast/predicate.test.js"
import "./test/conformance/ast/inject.test.js"
import "./test/conformance/ast/version.test.js"
import "./test/conformance/ast/property.test.js"

const results = await Test.run(process.argv[2])

console.log(
    `Conformance: ${results.passed}/${results.total} clauses green` +
        (results.failed ? ` — ${results.failed} red (spec awaiting implementation)` : "")
)
