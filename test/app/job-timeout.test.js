/**
 * The job-execution timeout stops leaking, and stops leaving work running
 * (JOB-TIMEOUT-*) — issue #9 I6.
 *
 * `execute()` rejected on a timer and did nothing else. Three consequences, in
 * ascending severity:
 *
 *  1. The `threads.queues` entry stayed forever — one leak per timed-out job.
 *  2. The worker kept running the hung handler, so its side effect still fired
 *     AFTER main had settled the job as failed and scheduled a retry. An
 *     at-least-once pipeline turning into an uncontrolled-concurrency one.
 *  3. EXEC_TIMEOUT_MS EQUALLED LEASE_MS, so there was no window in which the
 *     runner had given up but the lease had not expired — another runner could
 *     claim the job at the very instant the first was still inside it.
 *
 * (1) alone would reclaim the memory and leave the real problem, which is (2).
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { threads } from "../../src/core/Threads.js"
import { startJobThread, EXEC_TIMEOUT_MS } from "../../src/core/App/jobthread.js"
import { LEASE_MS } from "../../src/core/App/jobs.js"

Test.describe("Job execution timeout (JOB-TIMEOUT)", () => {

    Test.it("JOB-TIMEOUT-02 the execution timeout is strictly SHORTER than the lease — the invariant, not the numbers", () => {
        // At equality there is no window in which the runner has given up but
        // the lease has not yet expired, so a second runner can claim a job the
        // first is still inside. Pinning the relation rather than the constants
        // means tuning either one cannot silently reintroduce the overlap.
        assert.truthy(
            EXEC_TIMEOUT_MS < LEASE_MS,
            `EXEC_TIMEOUT_MS (${EXEC_TIMEOUT_MS}) must be strictly less than LEASE_MS (${LEASE_MS})`
        )
    })

    Test.it("JOB-TIMEOUT-01 a handler that never answers leaves no queue entry behind, and no worker still running it", async () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-jobtimeout-"))
        mkdirSync(join(scratch, "apps", "fx"), { recursive: true })
        // A handler that never resolves — the hang this is all about.
        writeFileSync(
            join(scratch, "apps", "fx", "hooks.js"),
            `export default ({ job }) => {
    job("fx.hang", { run: () => new Promise(() => {}) })
}
`
        )

        const before = Object.keys(threads.queues).length
        const rig = await startJobThread({ root: scratch, apps: [{ dir: "fx" }], config: {}, timeoutMs: 150 })
        const hungWorker = threads.threads["job"]

        await assert.rejects(rig.execute({ id: "j1", name: "fx.hang", payload: {} }), "E_TIMEOUT")

        assert.equal(Object.keys(threads.queues).length, before, "the abandoned queue entry must be reclaimed, not leaked")
        // The worker running the hung handler must be GONE — otherwise its side
        // effect still fires after main has settled the job as failed and
        // scheduled a retry. It is replaced rather than merely stopped, because
        // v1's pool is one thread and the runner has to keep working.
        assert.notEqual(threads.threads["job"], hungWorker, "the hung worker must have been replaced, not left running")
        assert.truthy(rig.running(), "and a fresh one must be in its place")

        await rig.stop()
        rmSync(scratch, { recursive: true, force: true })
    })

    Test.it("JOB-TIMEOUT-03 the thread is usable again after a timeout — recycling recovers the runner, it does not end it", async () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-jobtimeout2-"))
        mkdirSync(join(scratch, "apps", "fx"), { recursive: true })
        writeFileSync(
            join(scratch, "apps", "fx", "hooks.js"),
            `export default ({ job }) => {
    job("fx.hang", { run: () => new Promise(() => {}) })
    job("fx.echo", { run: async ({ payload }) => ({ echoed: payload.msg }) })
}
`
        )
        const rig = await startJobThread({ root: scratch, apps: [{ dir: "fx" }], config: {}, timeoutMs: 150 })

        await assert.rejects(rig.execute({ id: "j1", name: "fx.hang", payload: {} }), "E_TIMEOUT")
        const result = await rig.execute({ id: "j2", name: "fx.echo", payload: { msg: "still here" } })

        assert.equal(result.echoed, "still here", "one hung job must not take the runner down with it")

        await rig.stop()
        rmSync(scratch, { recursive: true, force: true })
    })
})
