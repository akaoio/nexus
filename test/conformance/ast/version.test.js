/**
 * Query AST v1 conformance — VERSIONING (AST-N).
 *
 * Encodes principle N4 (frozen formats, explicit versions, upgraders):
 * the version lives IN the document, unknown versions are rejected loudly,
 * and upgrade() is the only path between versions. Today v1 is the only
 * version, so upgrade() is the identity on v1 — but the contract shape is
 * pinned now, forever.
 */

import Test, { assert } from "../../../src/core/Test.js"
import AST from "./_load.js"
import { doc, leaf, hasError } from "./_helpers.js"

Test.describe("AST v1 — versioning (AST-N)", () => {
    Test.it("AST-N01 AST_VERSION is 1", () => {
        assert.equal(AST.AST_VERSION, 1)
    })

    Test.it("AST-N02 a document without astVersion is E_VERSION", () => {
        assert.truthy(hasError(AST.validate({ root: null }), "E_VERSION"))
    })

    Test.it("AST-N03 an unknown/future astVersion is E_VERSION_UNKNOWN — never silently accepted", () => {
        assert.truthy(hasError(AST.validate({ astVersion: 2, root: null }), "E_VERSION_UNKNOWN"))
        assert.truthy(hasError(AST.validate({ astVersion: "1", root: null }), "E_VERSION_UNKNOWN"))
    })

    Test.it("AST-N04 upgrade() of a v1 document returns an equivalent v1 document", () => {
        const input = doc(leaf("tier", "eq", "gold"))
        const upgraded = AST.upgrade(input)
        assert.equal(upgraded.astVersion, 1)
        assert.deepEqual(upgraded, input)
    })

    Test.it("AST-N05 upgrade() rejects unknown versions with E_VERSION_UNKNOWN", () => {
        assert.throws(() => AST.upgrade({ astVersion: 99, root: null }), "E_VERSION_UNKNOWN")
    })
})
