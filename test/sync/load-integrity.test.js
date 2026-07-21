/**
 * Sync stub load-integrity (SYNCLOAD-01, issue #9 H2 follow-up) — the
 * NOT_IMPLEMENTED stub in _load.js must stand in only for an ABSENT
 * src/core/Sync.js. A present-but-broken module (syntax error, throwing
 * top-level code, a bad import) must have its own import error propagate;
 * it must never be swallowed into the "not yet implemented" stub.
 */

import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { pathToFileURL } from "url"
import Test, { assert } from "../../src/core/Test.js"
import { loadSync } from "./_load.js"

Test.describe("Sync stub load integrity (SYNCLOAD)", () => {
    Test.it("SYNCLOAD-01 a present-but-broken Sync module surfaces its import error; an absent one yields the stub", async () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-syncload-"))
        const broken = join(scratch, "broken.js")
        writeFileSync(broken, "throw new Error('boom from broken module')\n")
        try {
            const err = await assert.rejects(loadSync(pathToFileURL(broken).href, true))
            assert.truthy(
                err.message.includes("boom from broken module"),
                `expected the broken module's own error, got "${err.message}"`
            )
            assert.falsy(
                err.message.includes("NOT_IMPLEMENTED"),
                `a present-but-broken module must never fall back to the stub, got "${err.message}"`
            )

            const stub = await loadSync("file:///does-not-exist.js", false)
            assert.throws(() => stub.anything(), "NOT_IMPLEMENTED")
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })
})
