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

// Conformance — Model Schema v1 (clauses MS-S/T/D/C/N)
import "./test/conformance/model/structure.test.js"
import "./test/conformance/model/types.test.js"
import "./test/conformance/model/diff.test.js"
import "./test/conformance/model/customize.test.js"
import "./test/conformance/model/version.test.js"

// Conformance — Permission v1 (clauses PERM-A/R/F/SH)
import "./test/conformance/permission/resolve.test.js"
import "./test/conformance/permission/rules.test.js"
import "./test/conformance/permission/fields.test.js"
import "./test/conformance/permission/sharing.test.js"

// Data Plane — vendored Kysely boundary (clauses VND-*)
import "./test/data/vendor.test.js"

// Data Plane — AST→Kysely compiler vs the reference predicate (clauses CMP-*)
import "./test/data/compile.test.js"

// Data Plane — Model→DDL compiler on a real engine (clauses DDL-*)
import "./test/data/ddl.test.js"

// Data Plane — Migration Engine on a real engine (clauses MIG-*)
import "./test/data/migrate.test.js"

// Data Plane — CRUD API full-stack on a real engine (clauses DPL-*)
import "./test/data/dataplane.test.js"

// Data Plane — engine adapters behind the executor contract (clauses ADP-*)
import "./test/data/adapters.test.js"

// Kernel — extracted from akao (clauses KRN-EN/UT/EV/ST/RT/TH/UI)
import "./test/kernel/utils.test.js"
import "./test/kernel/events.test.js"
import "./test/kernel/states.test.js"
import "./test/kernel/router.test.js"
import "./test/kernel/threads.test.js"
import "./test/kernel/ui.test.js"
import "./test/kernel/fs.test.js"
import "./test/kernel/sql.test.js"
import "./test/kernel/storage.test.js"
import "./test/kernel/hmr.test.js"

// CLI — spawned as a real process (clauses CLI-*)
import "./test/cli/cli.test.js"

// HTTP API — auto-generated from schemas, e2e over real HTTP (clauses API-*)
import "./test/http/api.test.js"

// Studio — nx-query-builder (clauses NXQ-*; DOM clauses run in the browser)
import "./test/studio/query-builder.test.js"

// Studio — nx-form-builder + nx-form (clauses NXF-*)
import "./test/studio/form-builder.test.js"

// Studio — nx-permission-manager (clauses NXP-*)
import "./test/studio/permission-manager.test.js"

// Studio — nx-schema-designer (clauses NXS-*)
import "./test/studio/schema-designer.test.js"

const results = await Test.run(process.argv[2])

console.log(
    `Conformance: ${results.passed}/${results.total} clauses green` +
        (results.failed ? ` — ${results.failed} red (spec awaiting implementation)` : "")
)
