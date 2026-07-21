/**
 * Test-runner conformance — the verdict rule itself (clause RUN-01).
 *
 * The harness's exit code and printed summary are the only signal CI sees.
 * A run that registers and executes zero real tests (everything skipped, or
 * a suite that failed to load and registered nothing) must never read as
 * success. `isGreen` is the single source of that rule — this pins it
 * directly, without depending on process.exitCode plumbing.
 */

import Test, { assert, isGreen } from "../../src/core/Test.js"

Test.describe("Test runner — verdict (RUN-01)", () => {
    Test.it("RUN-01 a run that passed zero tests is not green, even with zero failures", () => {
        assert.equal(isGreen({ passed: 0, failed: 0, skipped: 5, total: 5 }), false, "all-skipped is not success")
        assert.equal(isGreen({ passed: 0, failed: 0, skipped: 0, total: 0 }), false, "no tests registered is not success")
        assert.equal(isGreen({ passed: 3, failed: 0, skipped: 2, total: 5 }), true, "real passes with some skips is green")
        assert.equal(isGreen({ passed: 3, failed: 1, skipped: 0, total: 4 }), false, "any failure is not green")
    })
})
