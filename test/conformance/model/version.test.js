/**
 * Model Schema v1 conformance — VERSIONING (MS-N).
 *
 * Same N4 contract as the AST: version lives in the document, unknown
 * versions are rejected loudly, upgrade() is the only path forward.
 */

import Test, { assert } from "../../../src/core/Test.js"
import Model from "./_load.js"
import { schema, hasError } from "./_helpers.js"

Test.describe("Model Schema v1 — versioning (MS-N)", () => {
    Test.it("MS-N01 SCHEMA_VERSION is 1", () => {
        assert.equal(Model.SCHEMA_VERSION, 1)
    })

    Test.it("MS-N02 a schema without schemaVersion is E_VERSION", () => {
        const s = schema()
        delete s.schemaVersion
        assert.truthy(hasError(Model.validate(s), "E_VERSION"))
    })

    Test.it("MS-N03 an unknown/future schemaVersion is E_VERSION_UNKNOWN", () => {
        assert.truthy(hasError(Model.validate(schema({ schemaVersion: 2 })), "E_VERSION_UNKNOWN"))
        assert.truthy(hasError(Model.validate(schema({ schemaVersion: "1" })), "E_VERSION_UNKNOWN"))
    })

    Test.it("MS-N04 upgrade() of a v1 schema is the identity; unknown versions throw", () => {
        const s = schema()
        assert.deepEqual(Model.upgrade(s), s)
        assert.throws(() => Model.upgrade(schema({ schemaVersion: 99 })), "E_VERSION_UNKNOWN")
    })
})
