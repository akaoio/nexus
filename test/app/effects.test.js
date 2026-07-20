/**
 * App system — the EFFECT APP's pure surface (WH-01). The live webhook path
 * (a real row write firing a real HTTP receiver, signed + delivery-id'd) is
 * WH-02 in test/http/jobs-live.test.js, which reuses that suite's running
 * dev server rather than spawning a second one.
 */

import { createHmac } from "crypto"
import Test, { assert } from "../../src/core/Test.js"
import { sign, validateWebhookRow } from "../../src/core/App/effects.js"
import { mailProvider } from "../../src/core/App/mailer.js"

Test.describe("App — effect app: webhook consumer (WH-*)", () => {
    Test.it("WH-01 sign(): HMAC-SHA256 hex over the exact JSON body", () => {
        const body = { entity: "task", event: "after:create", id: "r1", ts: 1000 }
        const expected = createHmac("sha256", "s3cret").update(JSON.stringify(body)).digest("hex")
        assert.equal(sign("s3cret", body), expected)
    })

    Test.it("WH-04 validateWebhookRow: only http(s) URLs are accepted", () => {
        assert.equal(validateWebhookRow({ url: "https://ok.example/hook" }).valid, true)
        assert.equal(validateWebhookRow({ url: "http://ok.example/hook" }).valid, true)
        assert.equal(validateWebhookRow({ url: "file:///etc/passwd" }).valid, false)
        assert.equal(validateWebhookRow({ url: "ftp://x/y" }).valid, false)
        assert.equal(validateWebhookRow({ url: "not a url" }).valid, false)
    })
})

Test.describe("App — effect app: mail consumer (MAIL-*)", () => {
    Test.it("MAIL-01 the log provider sends without any dependency; smtp without nodemailer fails with E_PROVIDER", async () => {
        const log = mailProvider({}, "/nonexistent")
        const sent = await log.send({ to: "a@b.c", subject: "hi", text: "t" })
        assert.truthy(sent.id.startsWith("log-"))
        let error = null
        try { mailProvider({ mail: { provider: "smtp" } }, "/nonexistent") } catch (e) { error = e }
        assert.truthy(String(error?.message).startsWith("E_PROVIDER"))
    })
})
