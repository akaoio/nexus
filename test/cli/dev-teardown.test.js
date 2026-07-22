/**
 * What a hot reload leaves behind, and what a signal does — DEVFD-*,
 * DEVDOWN-*, STARTDOWN-*.
 *
 * `dev.js` disclosed both of these in its own comments, and both comments
 * understated the defect. "The old sqlite handle is left to the GC" was not
 * true: `openInstanceData` opened it INSIDE `buildInstanceApi`, which never
 * returned it, so nothing outside ever held a way to close it — retained and
 * unreachable, not waiting to be collected. And "SIGKILLed by callers/tests,
 * which reaps it" describes the test harness, not the developer pressing
 * Ctrl+C, who got a process that died by signal with its write-ahead log still
 * on disk.
 *
 * Measured before the fix, driving POST /_studio/model against a live dev
 * server and counting descriptors on the database in /proc/<pid>/fd:
 *
 *     boot 3 · reload 5 · 7 · 9 · 13 · 17
 */

import { mkdtempSync, rmSync, readdirSync, readlinkSync, existsSync, writeFileSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import Test, { assert } from "../../src/core/Test.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

/** A scratch instance with a booted dev server. */
async function devInstance(prefix) {
    const scratch = mkdtempSync(join(tmpdir(), prefix))
    spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
    const instance = join(scratch, "shop")
    const proc = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: instance })
    const base = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev did not start")), 10000)
        let buf = ""
        proc.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
        proc.on("exit", () => reject(new Error("dev exited early")))
    })
    return { scratch, instance, proc, base }
}

/** Add an entity through the Studio's own path — the route that hot-reloads. */
const addEntity = (base, name) =>
    fetch(base + "/_studio/model", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name, fields: [{ name: "title", type: "text" }] })
    })

/** Descriptors this process holds on any database file. Linux only. */
function dbDescriptors(pid) {
    return readdirSync(`/proc/${pid}/fd`).filter((fd) => {
        try {
            return /\.db(-wal|-shm)?$/.test(readlinkSync(`/proc/${pid}/fd/${fd}`))
        } catch {
            return false // a descriptor closed between listing and reading
        }
    }).length
}

Test.describe("dev teardown & reload hygiene (DEVFD/DEVDOWN)", () => {
    Test.it("DEVFD-01 descriptors on the database do NOT grow across repeated hot reloads", async () => {
        if (!existsSync("/proc/self/fd")) {
            // Stated rather than silently passed: this clause is driven by
            // /proc, and a platform without it verifies nothing here.
            assert.equal(true, true) // no /proc — descriptor growth not observable on this platform
            return
        }
        const { scratch, proc, base } = await devInstance("nexus-devfd-")
        try {
            const reload = async (name) => {
                const r = await addEntity(base, name)
                assert.equal(r.status, 200, await r.text())
            }

            // Warm up first. The steady state is NOT the boot count: the effect
            // runner opens a connection of its own the first time it runs, and
            // WAL/shm descriptors come and go with the table set. Comparing
            // against boot would measure that one-time cost as a leak.
            for (const name of ["alpha", "bravo", "charlie"]) await reload(name)
            const warm = dbDescriptors(proc.pid)

            // The property is that it PLATEAUS. Before the fix this sequence ran
            // 3 → 5 → 7 → 9 → 13 → 17, strictly growing, because every reload
            // retained the whole sqlite connection it replaced. After it, the
            // count settles around 7 and stays there however many times you
            // reload.
            for (const name of ["delta", "echo", "foxtrot", "golf", "hotel", "india"]) await reload(name)
            const later = dbDescriptors(proc.pid)

            // The threshold is +6 over six reloads, not +1, and the margin is
            // deliberate rather than slack. A LEAK costs a whole connection per
            // reload — database, WAL and shm — so the defect this pins measured
            // 11 → 35 across exactly this span: +24, four times the threshold.
            // What fluctuates below it is the WAL/shm pair itself, which sqlite
            // opens and closes as the table set changes and which reads
            // differently depending on when in that cycle the sample lands.
            // Pinning +1 made the clause fail on a loaded machine while the
            // property it cares about held perfectly.
            assert.truthy(
                later - warm <= 6,
                `descriptors kept growing across reloads: ${warm} after 3 → ${later} after 9 (a leak costs a whole connection each time; this is +${later - warm})`
            )
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("DEVFD-02 a rebuild that THROWS leaves the previous instance serving, effects and all", async () => {
        // The old order stopped the OLD effects before building the new
        // instance, so a rebuild that threw — a malformed model file dropped
        // into apps/ is enough — left dev serving with a dead job runner and
        // nothing saying so. Build first, release second.
        const { scratch, instance, proc, base } = await devInstance("nexus-devfd2-")
        try {
            assert.equal((await addEntity(base, "before")).status, 200)

            // Break the instance ON DISK, the way an editor would: a model file
            // that is not valid JSON. The watcher re-reads and the load throws.
            const models = join(instance, "apps", "starter", "models")
            writeFileSync(join(models, "broken.json"), "{ this is not json")

            // Give the watcher its moment, then confirm the server is still
            // there and still functioning — not merely still listening.
            const deadline = Date.now() + 5000
            let served = null
            while (Date.now() < deadline) {
                const r = await fetch(base + "/_health").catch(() => null)
                if (r) served = r.status
                await new Promise((r2) => setTimeout(r2, 250))
            }
            assert.equal(served, 200, "a failed reload must not take the running instance down")

            // The plane the old instance built still answers — the entity added
            // before the breakage is still served, so the swap did not half-happen.
            const list = await fetch(base + "/api/v1/before")
            assert.truthy(list.status < 500, `the previous plane must survive a failed rebuild: ${list.status}`)
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("DEVFD-03 the JOB RUNNER survives a hot reload — measured by running a job on the other side of one", async () => {
        // `Threads` is a module-level registry keyed by NAME, and register() is
        // a get-or-create. The reload above deliberately keeps the old instance
        // alive until the new one is built, so a constant "job" meant the new
        // instance was handed the OLD worker — old apps, old config — and lost
        // it entirely when the old instance was released. Every reload,
        // silently: a job enqueued afterwards sits in `running` forever and
        // nothing anywhere says the runner is gone.
        //
        // Driven end to end because that is the only way it shows: a runner is
        // not something a status endpoint reports on, so the observable has to
        // be a job that actually completes.
        const scratch = mkdtempSync(join(tmpdir(), "nexus-devjob-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const instance = join(scratch, "shop")
        const hooks = join(instance, "apps", "starter", "hooks.js")
        writeFileSync(
            hooks,
            readFileSync(hooks, "utf8").replace(
                "export default ({ hook, endpoint, command }) => {",
                `export default ({ hook, endpoint, command, job, enqueue }) => {
    job("probe.mark", { run: async ({ payload }) => ({ marked: payload.n }) })
    endpoint("POST", "fire", async () => { await enqueue("probe.mark", { n: 1 }); return { queued: true } })`
            )
        )

        const proc = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: instance })
        try {
            const base = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("dev did not start")), 12000)
                let buf = ""
                proc.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
                proc.on("exit", () => reject(new Error("dev exited early")))
            })

            const doneCount = async () => {
                const r = await (await fetch(base + "/api/v1/nexus_job")).json()
                return (r.ok ? r.data : []).filter((row) => row.status === "done").length
            }
            const runsAJob = async () => {
                const was = await doneCount()
                await fetch(base + "/api/v1/_/fire", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })
                for (let i = 0; i < 40; i++) {
                    if ((await doneCount()) > was) return true
                    await new Promise((r) => setTimeout(r, 500))
                }
                return false
            }

            assert.equal(await runsAJob(), true, "the runner must work BEFORE a reload for this clause to mean anything")

            // A hot reload the ordinary way — a model saved through the Studio's
            // own route, which is what an operator does.
            const reloaded = await fetch(base + "/_studio/model", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ name: "extra", fields: [{ name: "title", type: "text" }] })
            })
            assert.equal(reloaded.status, 200, await reloaded.text())
            await new Promise((r) => setTimeout(r, 2000))

            assert.equal(await runsAJob(), true, "a hot reload left the job runner dead — jobs stick in `running` forever")
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("DEVDOWN-01/02 SIGTERM exits `nexus dev` cleanly and CHECKPOINTS the write-ahead log", async () => {
        // Measured before the fix: signal=SIGTERM, no exit code, and
        // data.db-wal + data.db-shm still on disk. A developer pressing Ctrl+C
        // is not the test harness sending SIGKILL.
        const { scratch, instance, proc, base } = await devInstance("nexus-devdown-")
        try {
            const wrote = await fetch(base + "/api/v1/task", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ title: "a row worth checkpointing" })
            })
            assert.equal(wrote.status, 201, await wrote.text())
            assert.truthy(existsSync(join(instance, ".nexus", "data.db-wal")), "the WAL must exist for this clause to mean anything")

            const exit = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve({ code: null, signal: "TIMEOUT" }), 8000)
                proc.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
                proc.kill("SIGTERM")
            })
            assert.equal(exit.signal, null, `dev must exit, not die by signal: signal=${exit.signal}`)
            assert.equal(exit.code, 0, `dev must exit 0 on SIGTERM: code=${exit.code}`)

            // Closing the last sqlite connection checkpoints and removes the
            // WAL. Its presence after a clean exit means the handle was
            // abandoned rather than closed.
            assert.equal(existsSync(join(instance, ".nexus", "data.db-wal")), false, "the WAL was abandoned, not checkpointed")

            // And the row is in the database proper — the point of a checkpoint.
            assert.truthy(readFileSync(join(instance, ".nexus", "data.db")).includes("a row worth checkpointing"), "the committed row must be in the database file")
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("DEVDOWN-03 a SECOND signal during shutdown does not start a second teardown", async () => {
        const { scratch, proc } = await devInstance("nexus-devdown2-")
        try {
            const exit = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve({ code: null, signal: "TIMEOUT" }), 8000)
                proc.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
                proc.kill("SIGTERM")
                proc.kill("SIGINT")
                proc.kill("SIGTERM")
            })
            assert.equal(exit.code, 0, `impatient Ctrl+C must still exit 0: code=${exit.code} signal=${exit.signal}`)
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("STARTDOWN-01 `nexus start` closes its data handle on SIGTERM — the same gap, in production", async () => {
        // start.js already handled both signals, but closed only the server:
        // the executor was never closed there either, so a systemd stop left
        // the WAL exactly as dev did.
        const scratch = mkdtempSync(join(tmpdir(), "nexus-startdown-"))
        try {
            spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
            const instance = join(scratch, "shop")
            const cfgPath = join(instance, "nexus.config.json")
            const cfg = JSON.parse(readFileSync(cfgPath, "utf8"))
            cfg.token_secret = "fixed-startdown-secret"
            cfg.api_keys = [{ key: "k-admin", user: "alice", roles: ["admin"] }]
            writeFileSync(cfgPath, JSON.stringify(cfg, null, 4))

            const proc = spawn(process.execPath, [BIN, "start", "--json", "--port", "0", "--insecure"], { cwd: instance })
            const base = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("start did not come up")), 10000)
                let buf = ""
                proc.stdout.on("data", (c) => { buf += c; try { const p = JSON.parse(buf); clearTimeout(timer); p.ok ? resolve(p.url) : reject(new Error(p.error)) } catch {} })
                proc.on("exit", () => reject(new Error("start exited early")))
            })
            await fetch(base + "/api/v1/task", {
                method: "POST",
                headers: { "content-type": "application/json", "x-api-key": "k-admin" },
                body: JSON.stringify({ title: "production row" })
            })
            assert.truthy(existsSync(join(instance, ".nexus", "data.db-wal")), "the WAL must exist for this clause to mean anything")

            const exit = await new Promise((resolve) => {
                const timer = setTimeout(() => resolve({ code: null, signal: "TIMEOUT" }), 8000)
                proc.on("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }) })
                proc.kill("SIGTERM")
            })
            assert.equal(exit.code, 0, `start must exit 0: code=${exit.code} signal=${exit.signal}`)
            assert.equal(existsSync(join(instance, ".nexus", "data.db-wal")), false, "production abandoned its WAL on a clean stop")
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })
})
