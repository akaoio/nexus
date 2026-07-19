/**
 * The effect runner lives in the server (design 2026-07-19 §2/§3, JOBL-*): a
 * real dev server, a real job thread, no restart, no fake clock — endpoint
 * enqueues → runnerTick claims on the main thread → the job THREAD executes
 * the handler → the plane settles the row. This is the ONE clause allowed to
 * poll real time (bounded 15s) — it proves the whole path end to end; the
 * engine's own timing logic is clock-injected and covered by JOB-*.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { createServer } from "http"
import Test, { assert } from "../../src/core/Test.js"
import { sign } from "../../src/core/App/effects.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

const scratch = mkdtempSync(join(tmpdir(), "nexus-jobslive-"))
spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
const instance = join(scratch, "shop")
// the fixture handler + endpoint MUST be on disk before the server boots —
// the job thread loads apps/*/hooks.js at spawn time (design §3)
mkdirSync(join(instance, "apps", "starter"), { recursive: true })
writeFileSync(
    join(instance, "apps", "starter", "hooks.js"),
    `export default ({ hook, endpoint, command, job, enqueue }) => {
    job("starter.mark", { run: async ({ payload }, { plane }) => plane.create("nexus_notification", { user: payload.user, title: "marked", read: false }) })
    endpoint("POST", "mark", async () => ({ queued: (await enqueue("starter.mark", { user: "pubZ" })).id }))
}
`
)

let server = null
let base = null
async function ensure() {
    if (base) return base
    server = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: instance })
    base = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev did not start")), 8000)
        let buf = ""
        server.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
        server.on("exit", () => reject(new Error("dev exited early")))
    })
    return base
}
const post = async (path, body) => {
    const r = await fetch((await ensure()) + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    return { status: r.status, body: await r.json() }
}

Test.describe("Effect runner lives in the server (JOBL-*)", () => {
    Test.it("JOBL-01 endpoint enqueues → runner claims → thread executes → notification row lands (no restart, real process)", async () => {
        const q = await post("/api/v1/_/mark", {})
        assert.equal(q.body.ok, true)
        // poll the API (not the clock): the runner ticks at poll_ms=1000 in dev
        let rows = []
        for (let i = 0; i < 30 && !rows.length; i++) {
            await new Promise((r) => setTimeout(r, 500))
            const res = await post("/api/v1/nexus_notification/query", { filter: null, limit: 10 })
            rows = res.body.ok ? res.body.data : []
        }
        assert.equal(rows.length, 1)
        assert.equal(rows[0].user, "pubZ")
        const jobs = await post("/api/v1/nexus_job/query", { filter: null, limit: 10 })
        assert.equal(jobs.body.data[0].status, "done")
    })

    Test.it("WH-02 a row write fires the webhook: signed and delivery-id'd", async () => {
        const seen = []
        const rx = createServer((req, res) => {
            let raw = ""
            req.on("data", (c) => (raw += c))
            req.on("end", () => {
                seen.push({ raw, sig: req.headers["x-nexus-signature"], delivery: req.headers["x-nexus-delivery"] })
                res.writeHead(200).end()
            })
        })
        await new Promise((r) => rx.listen(0, r))
        try {
            const rxUrl = `http://127.0.0.1:${rx.address().port}/hook`
            // subscribe via ordinary rows — the editor's own write path
            await post("/api/v1/nexus_webhook", { url: rxUrl, entity: "task", events: JSON.stringify(["after:create"]), secret: "s3cret", enabled: true })
            await post("/api/v1/task", { title: "fire one" })
            for (let i = 0; i < 30 && seen.length < 1; i++) await new Promise((r) => setTimeout(r, 500))
            assert.equal(seen.length >= 1, true, "the webhook fired")
            const body = JSON.parse(seen[0].raw)
            assert.equal(body.entity, "task")
            assert.equal(body.event, "after:create")
            assert.equal(seen[0].sig, sign("s3cret", body))
            assert.truthy(seen[0].delivery)
        } finally {
            rx.close() // a failed assertion must never leave the receiver socket open (hangs the process)
        }
    })

    Test.it("JOBL-99 cleanup", async () => {
        if (server) await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        assert.equal(true, true)
    })
})
