/**
 * WebAuthn PRF → ZEN identity conformance (AUTH-PRF-*) — docs/authn-design.md.
 * The security property is DETERMINISM: a credential's PRF secret always
 * derives the same keypair, and no private key is stored. That is pure and
 * hardware-free — proven here with a fixed PRF output standing in for the
 * authenticator's bytes (the VALUE, not a mocked ceremony). Reading the PRF
 * output from a physical/virtual authenticator is the one interactive step,
 * exercised with a real authenticator, never faked.
 */

import Test, { assert } from "../../src/core/Test.js"
import { prfSeed, identityFromPRF } from "../../src/core/App/webauthn.js"

const ZEN = (await import("../../vendor/zen/zen.js")).default
const bytes = (...n) => new Uint8Array(n.length === 1 ? Array.from({ length: 32 }, (_, i) => (n[0] + i) & 0xff) : n)

Test.describe("WebAuthn PRF → ZEN identity (AUTH-PRF)", () => {
    Test.it("AUTH-PRF-01 the same PRF secret always derives the same keypair — no key is stored", async () => {
        const prf = bytes(7)
        const a = await identityFromPRF(prf, ZEN)
        const b = await identityFromPRF(new Uint8Array(prf), ZEN) // a fresh buffer, same bytes
        assert.equal(a.pub, b.pub)
        assert.equal(a.priv, b.priv)
        assert.truthy(a.pub.length > 0)
    })

    Test.it("AUTH-PRF-02 a different PRF secret derives a different identity", async () => {
        const a = await identityFromPRF(bytes(7), ZEN)
        const b = await identityFromPRF(bytes(9), ZEN)
        assert.notEqual(a.pub, b.pub)
    })

    Test.it("AUTH-PRF-03 the seed is a stable hex digest; the domain tag scopes it", async () => {
        const prf = bytes(1)
        const s1 = await prfSeed(prf)
        const s2 = await prfSeed(new Uint8Array(prf))
        assert.equal(s1, s2)
        assert.truthy(/^[0-9a-f]{64}$/.test(s1)) // SHA-256 hex
        assert.notEqual(await prfSeed(prf, "other-domain"), s1) // domain separation
    })

    Test.it("AUTH-PRF-04 the derived identity signs and verifies through the same ZEN path as the engine", async () => {
        const id = await identityFromPRF(bytes(42), ZEN)
        const sig = await ZEN.sign("hello", id)
        const message = await ZEN.verify(sig, id.pub)
        assert.equal(message, "hello")
    })
})
