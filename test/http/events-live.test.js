/**
 * Realtime on the wire (EVT-*, live clauses) — a real dev server, real SSE
 * consumers over `fetch`, two instances mirroring POLWIN's preamble exactly:
 * A is authless (default `nexus create`), B boots with auth ON (two API
 * keys) plus a FILE baseline granting viewer read on `task` only. Proves the
 * hub end to end: pinned event shape, per-subscriber permission gating,
 * nexus_job opt-in, and the `?token=` fallback EventSource needs.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

async function sseConsumer(url, { headers = {} } = {}) {
    const controller = new AbortController()
    const res = await fetch(url, { headers: { accept: "text/event-stream", ...headers }, signal: controller.signal })
    const received = []
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ""
    ;(async () => {
        try {
            for (;;) {
                const { done, value } = await reader.read()
                if (done) break
                buf += decoder.decode(value, { stream: true })
                let i
                while ((i = buf.indexOf("\n\n")) >= 0) {
                    const frame = buf.slice(0, i); buf = buf.slice(i + 2)
                    if (frame.startsWith("data:")) received.push(JSON.parse(frame.slice(5)))
                }
            }
        } catch { /* aborted */ }
    })()
    return { received, stop: () => controller.abort(), status: res.status }
}
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 200)); return fn() }

// ── Instance A: authless (default `nexus create shop`) ─────────────────────
const scratchA = mkdtempSync(join(tmpdir(), "nexus-evtlive-a-"))
spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratchA })
const instanceA = join(scratchA, "shop")

let serverA = null
let baseA = null
async function ensureA() {
    if (baseA) return baseA
    serverA = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: instanceA })
    baseA = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev did not start")), 8000)
        let buf = ""
        serverA.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
        serverA.on("exit", () => reject(new Error("dev exited early")))
    })
    return baseA
}
const postA = async (path, body, method = "POST") => {
    const r = await fetch((await ensureA()) + path, {
        method,
        headers: { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: r.status, body: await r.json() }
}

// ── Instance B: auth ON from boot (two API keys), FILE baseline grants
// viewer read on task ONLY — exactly the POLWIN preamble.
const scratchB = mkdtempSync(join(tmpdir(), "nexus-evtlive-b-"))
spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratchB })
const instanceB = join(scratchB, "shop")
const cfgPathB = join(instanceB, "nexus.config.json")
const cfgB = JSON.parse(readFileSync(cfgPathB, "utf8"))
cfgB.api_keys = [
    { key: "admin-key-0123456789abcdef", user: "root", roles: ["admin"] },
    { key: "viewer-key-0123456789abcde", user: "eye", roles: ["viewer"] }
]
writeFileSync(cfgPathB, JSON.stringify(cfgB, null, 4))
mkdirSync(join(instanceB, "apps", "starter", "permissions"), { recursive: true })
writeFileSync(join(instanceB, "apps", "starter", "permissions", "base.json"),
    JSON.stringify([{ entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: false, roles: ["viewer"] }]))

let serverB = null
let baseB = null
async function ensureB() {
    if (baseB) return baseB
    serverB = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: instanceB })
    baseB = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev did not start")), 8000)
        let buf = ""
        serverB.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
        serverB.on("exit", () => reject(new Error("dev exited early")))
    })
    return baseB
}
const postB = async (path, body, key) => {
    const r = await fetch((await ensureB()) + path, {
        method: "POST",
        headers: { "content-type": "application/json", "x-nexus-key": key },
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: r.status, body: await r.json() }
}
const ADMIN = "admin-key-0123456789abcdef"
const VIEWER = "viewer-key-0123456789abcde"

Test.describe("Realtime on the wire (EVT-*, live)", () => {
    Test.it("EVT-01 a create/update lands on the stream with the pinned shape and no row data", async () => {
        const c = await sseConsumer((await ensureA()) + "/api/v1/_events?entities=task")
        const made = await postA("/api/v1/task", { title: "sự kiện đầu tiên" })
        assert.truthy(await until(() => c.received.some((e) => e.event === "create" && e.id === made.body.data.id)))
        const e = c.received.find((x) => x.event === "create")
        assert.deepEqual(Object.keys(e).sort(), ["entity", "event", "id", "ts"])
        await postA(`/api/v1/task/${made.body.data.id}`, { title: "đổi" }, "PATCH")
        assert.truthy(await until(() => c.received.some((x) => x.event === "update")))
        c.stop()
    })

    Test.it("EVT-03 nexus_job is opt-in on the live stream", async () => {
        const def = await sseConsumer((await ensureA()) + "/api/v1/_events")
        const opt = await sseConsumer((await ensureA()) + "/api/v1/_events?entities=nexus_job")
        await postA("/api/v1/nexus_job", { name: "evt.probe", payload: "{}", status: "pending", run_at: new Date(Date.now() + 3600_000).toISOString(), attempts: 0, max_attempts: 5 })
        assert.truthy(await until(() => opt.received.some((e) => e.entity === "nexus_job")))
        assert.equal(def.received.filter((e) => e.entity === "nexus_job").length, 0)
        def.stop(); opt.stop()
    })

    Test.it("EVT-02 the permission clause: a subscriber never sees an event for a row it cannot read", async () => {
        const viewer = await sseConsumer((await ensureB()) + "/api/v1/_events", { headers: { "x-nexus-key": VIEWER } })
        const admin = await sseConsumer((await ensureB()) + "/api/v1/_events", { headers: { "x-nexus-key": ADMIN } })
        // nexus_policy: admin-only readable (SYSTEM_BASELINES grants nexus_user
        // and nexus_role a directory read for ANY signed-in user — nexus_policy
        // carries no such universal grant, only the admin ADMIN_ACTIONS bundle —
        // so it is the entity that is genuinely admin-only) — the viewer must see NOTHING
        await postB("/api/v1/nexus_policy", { entity: "task", actions: JSON.stringify(["read"]), rule: null, permlevel: 0, ifowner: false, roles: JSON.stringify(["ghost"]) }, ADMIN)
        assert.truthy(await until(() => admin.received.some((e) => e.entity === "nexus_policy")))
        assert.equal(viewer.received.filter((e) => e.entity === "nexus_policy").length, 0) // bounded negative: admin's arrival IS the window
        // task: viewer-readable — both see it
        await postB("/api/v1/task", { title: "public-ish" }, ADMIN)
        assert.truthy(await until(() => viewer.received.some((e) => e.entity === "task")))
        assert.truthy(admin.received.some((e) => e.entity === "task"))
        viewer.stop(); admin.stop()
    })

    Test.it("EVT-05 ?token= works where EventSource cannot set headers", async () => {
        // API keys ride x-nexus-key normally; ?token= must ALSO be accepted for this endpoint
        const c = await sseConsumer((await ensureB()) + "/api/v1/_events?token=" + encodeURIComponent(ADMIN))
        assert.equal(c.status, 200)
        await postB("/api/v1/task", { title: "qua token" }, ADMIN)
        assert.truthy(await until(() => c.received.some((e) => e.entity === "task")))
        c.stop()
        const anon = await fetch((await ensureB()) + "/api/v1/_events")
        assert.equal(anon.status, 401) // no credentials → E_AUTH like any endpoint
    })

    Test.it("EVT-99 cleanup", async () => {
        if (serverA) await new Promise((resolve) => { serverA.once("exit", resolve); serverA.kill("SIGKILL") })
        if (serverB) await new Promise((resolve) => { serverB.once("exit", resolve); serverB.kill("SIGKILL") })
        rmSync(scratchA, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        rmSync(scratchB, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        assert.equal(true, true)
    })
})
