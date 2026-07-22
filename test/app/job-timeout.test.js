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
import { startJobThread, bindPlaneRpc, EXEC_TIMEOUT_MS } from "../../src/core/App/jobthread.js"
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
        // Asked of the rig, not guessed from a shared constant. The name used
        // to be the literal "job", which is exactly what made two live
        // instances impossible (THRNS-01).
        const hungWorker = threads.threads[rig.name]

        await assert.rejects(rig.execute({ id: "j1", name: "fx.hang", payload: {} }), "E_TIMEOUT")

        assert.equal(Object.keys(threads.queues).length, before, "the abandoned queue entry must be reclaimed, not leaked")
        // The worker running the hung handler must be GONE — otherwise its side
        // effect still fires after main has settled the job as failed and
        // scheduled a retry. It is replaced rather than merely stopped, because
        // v1's pool is one thread and the runner has to keep working.
        assert.notEqual(threads.threads[rig.name], hungWorker, "the hung worker must have been replaced, not left running")
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

    Test.it("JOB-TIMEOUT-04 a worker that cannot come up says so in its OWN words, not a hung handler's", async () => {
        // Two different facts used to wear one error code. `execute` starts its
        // timer when it hands the job over, so a worker still importing its
        // module graph spent the HANDLER's budget booting and reported
        // E_TIMEOUT — which reads as "your handler hung". After a recycle that
        // is the common case, and the job that pays is an innocent one: its
        // timeout recycles the worker again, so the next job is likely to do
        // the same. One hung handler could walk healthy jobs into the DLQ.
        //
        // Startup gets its own budget and its own name. Squeezed to 1ms so no
        // real worker can answer in time — the only way to reach the message
        // without breaking a worker on purpose.
        const scratch = mkdtempSync(join(tmpdir(), "nexus-jobstart-"))
        mkdirSync(join(scratch, "apps", "fx"), { recursive: true })
        writeFileSync(join(scratch, "apps", "fx", "hooks.js"), `export default ({ job }) => { job("fx.echo", { run: async () => ({ ok: true }) }) }\n`)
        try {
            const before = Object.keys(threads.threads).length
            await assert.rejects(
                startJobThread({ root: scratch, apps: [{ dir: "fx" }], config: {}, timeoutMs: 5000, startupMs: 1 }),
                "E_THREAD_START"
            )
            // …and it takes its worker with it. No rig is returned on failure,
            // so nothing else COULD stop it — and a live worker thread keeps the
            // whole Node process alive, which turns "startup failed" into "the
            // run never ends". That is how this was found: the suite hung in CI
            // instead of reporting anything.
            assert.equal(Object.keys(threads.threads).length, before, "a failed start left its worker running")
        } finally {
            rmSync(scratch, { recursive: true, force: true })
        }
    })
})

Test.describe("One instance, one thread namespace (THRNS)", () => {
    const app = (scratch, answer) => {
        mkdirSync(join(scratch, "apps", "fx"), { recursive: true })
        writeFileSync(
            join(scratch, "apps", "fx", "hooks.js"),
            `export default ({ job }) => { job("fx.who", { run: async () => ({ who: ${JSON.stringify(answer)} }) }) }\n`
        )
        return scratch
    }

    Test.it("THRNS-01 two live instances hold two DIFFERENT workers, and stopping one leaves the other working", async () => {
        // The whole defect in one clause. `Threads` keys by NAME and
        // `register()` is a get-or-create, so a constant "job" meant the second
        // instance was handed the FIRST one's worker — old apps, old config —
        // and then lost it when the first was released. `nexus dev` makes two
        // instances on purpose during every hot reload, so this is not a corner.
        const a = app(mkdtempSync(join(tmpdir(), "nexus-thrns-a-")), "first")
        const b = app(mkdtempSync(join(tmpdir(), "nexus-thrns-b-")), "second")
        let rigA = null
        let rigB = null
        try {
            rigA = await startJobThread({ root: a, apps: [{ dir: "fx" }], config: {} })
            rigB = await startJobThread({ root: b, apps: [{ dir: "fx" }], config: {} })

            // Each must be running ITS OWN app, not the other's.
            assert.equal((await rigA.execute({ id: "1", name: "fx.who", payload: {} })).who, "first")
            assert.equal((await rigB.execute({ id: "2", name: "fx.who", payload: {} })).who, "second")

            // Releasing one must not disarm the other — the exact way a hot
            // reload used to kill the instance that had just replaced it.
            await rigA.stop()
            rigA = null
            assert.equal((await rigB.execute({ id: "3", name: "fx.who", payload: {} })).who, "second", "releasing one instance took another's worker with it")
        } finally {
            await rigA?.stop()
            await rigB?.stop()
            rmSync(a, { recursive: true, force: true })
            rmSync(b, { recursive: true, force: true })
        }
    })

    Test.it("THRNS-02 bindPlaneRpc RETURNS the name it bound, and two bindings do not overwrite each other", () => {
        // Returned rather than passed in: a caller asked to invent a name is a
        // caller that can forget, and forgetting reproduces the bug in silence.
        const plane = { create: async () => ({}), update: async () => ({}), get: async () => ({}), list: async () => [] }
        const one = bindPlaneRpc(plane, {})
        const two = bindPlaneRpc(plane, {})
        assert.truthy(one.planeName, "the binding must name itself")
        assert.notEqual(one.planeName, two.planeName)
        assert.truthy(threads.threads[one.planeName], "the first binding must survive the second")
        assert.truthy(threads.threads[two.planeName])
        delete threads.threads[one.planeName]
        delete threads.threads[two.planeName]
    })

    Test.it("THRNS-03 stop() takes its OWN worker and its OWN plane binding, and nothing else's", async () => {
        const a = app(mkdtempSync(join(tmpdir(), "nexus-thrns-c-")), "keep")
        let rig = null
        try {
            const before = Object.keys(threads.threads).length
            rig = await startJobThread({ root: a, apps: [{ dir: "fx" }], config: {} })
            const bystander = "bystander-" + Math.random().toString(36).slice(2, 8)
            threads.threads[bystander] = { postMessage() {}, removeAllListeners() {}, terminate() {} }

            await rig.stop()
            rig = null
            assert.truthy(threads.threads[bystander], "stop() reached past its own namespace")
            delete threads.threads[bystander]
            assert.equal(Object.keys(threads.threads).length, before, "stop() must leave the registry as it found it")
        } finally {
            await rig?.stop()
            rmSync(a, { recursive: true, force: true })
        }
    })
})
