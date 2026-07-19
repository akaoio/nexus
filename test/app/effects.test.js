/**
 * App system — the EFFECT APP's pure surface (WH-01). The live webhook path
 * (a real row write firing a real HTTP receiver, signed + delivery-id'd) is
 * WH-02 in test/http/jobs-live.test.js, which reuses that suite's running
 * dev server rather than spawning a second one.
 */

import { createHmac } from "crypto"
import Test, { assert } from "../../src/core/Test.js"
import { sign } from "../../src/core/App/effects.js"

Test.describe("App — effect app: webhook consumer (WH-*)", () => {
    Test.it("WH-01 sign(): HMAC-SHA256 hex over the exact JSON body", () => {
        const body = { entity: "task", event: "after:create", id: "r1", ts: 1000 }
        const expected = createHmac("sha256", "s3cret").update(JSON.stringify(body)).digest("hex")
        assert.equal(sign("s3cret", body), expected)
    })
})
