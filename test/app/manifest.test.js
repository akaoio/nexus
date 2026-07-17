/**
 * App system conformance — APP MANIFEST v1 (MF-*).
 * The third frozen public format of N4, and the §8.4.2 update-safety gate:
 * the core refuses apps outside their declared engines range — at load
 * time, loudly, never by crashing later.
 */

import Test, { assert } from "../../src/core/Test.js"
import { MANIFEST_VERSION, validate, satisfies, compatible, upgrade } from "../../src/core/App/manifest.js"

const MANIFEST = (over = {}) => ({ manifestVersion: 1, name: "crm", version: "1.2.3", ...over })
const hasError = (result, code) => result.valid === false && result.errors.some((e) => e.code === code)

Test.describe("App Manifest v1 (MF-*)", () => {
    Test.it("MF-01 a valid manifest validates; the envelope is frozen", () => {
        assert.equal(MANIFEST_VERSION, 1)
        assert.equal(validate(MANIFEST()).valid, true)
        assert.equal(validate(MANIFEST({ engines: { nexus: ">=1 <3" }, description: "d" })).valid, true)
        assert.truthy(hasError(validate(MANIFEST({ extra: 1 })), "E_MANIFEST_KEYS"))
        assert.truthy(hasError(validate({ name: "x", version: "1.0.0" }), "E_VERSION"))
        assert.truthy(hasError(validate(MANIFEST({ manifestVersion: 2 })), "E_VERSION_UNKNOWN"))
        assert.equal(validate(null).valid, false)
    })

    Test.it("MF-02 names and versions are validated loudly", () => {
        assert.truthy(hasError(validate(MANIFEST({ name: "My App" })), "E_NAME"))
        assert.truthy(hasError(validate(MANIFEST({ version: "1.2" })), "E_SEMVER"))
        assert.truthy(hasError(validate(MANIFEST({ version: "v1.2.3" })), "E_SEMVER"))
        assert.equal(validate(MANIFEST({ version: "1.2.3-beta.1" })).valid, true)
    })

    Test.it("MF-03 satisfies: the closed range grammar, exact semantics", () => {
        assert.equal(satisfies("1.5.0", ">=1 <3"), true)
        assert.equal(satisfies("3.0.0", ">=1 <3"), false)
        assert.equal(satisfies("0.9.9", ">=1 <3"), false)
        assert.equal(satisfies("2.0.0", "*"), true)
        assert.equal(satisfies("1.2.3", "1.2.3"), true)
        assert.equal(satisfies("1.2.4", "1.2.3"), false)
        assert.equal(satisfies("1.9.0", "^1.2.3"), true)
        assert.equal(satisfies("2.0.0", "^1.2.3"), false)
        assert.equal(satisfies("0.2.5", "^0.2.3"), true)
        assert.equal(satisfies("0.3.0", "^0.2.3"), false) // 0.x caret stays in the minor
        assert.equal(satisfies("1.0.0", ">1"), false)
        assert.equal(satisfies("1.0.1", ">1"), true)
        assert.throws(() => satisfies("nope", "*"), "E_SEMVER")
        assert.throws(() => satisfies("1.0.0", "~1.2"), "E_RANGE") // outside the closed grammar
    })

    Test.it("MF-04 compatible: absent engines is compatible; declared ranges gate the core", () => {
        assert.equal(compatible(MANIFEST(), "9.9.9"), true)
        assert.equal(compatible(MANIFEST({ engines: { nexus: ">=1 <3" } }), "2.1.0"), true)
        assert.equal(compatible(MANIFEST({ engines: { nexus: ">=1 <3" } }), "3.0.0"), false)
        assert.truthy(hasError(validate(MANIFEST({ engines: { nexus: "~weird" } })), "E_RANGE"))
        assert.truthy(hasError(validate(MANIFEST({ engines: "nexus" })), "E_ENGINES"))
    })

    Test.it("MF-05 upgrade is the N4 gate: identity on v1, loud otherwise", () => {
        assert.deepEqual(upgrade(MANIFEST()), MANIFEST())
        assert.throws(() => upgrade({ manifestVersion: 99 }), "E_VERSION_UNKNOWN")
    })
})
