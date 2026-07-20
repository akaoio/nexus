/**
 * Dev event stream (DEVE-*) — `/__dev_events`, the server half of the shipped
 * akao HMR client (core/HMR/client.js): a real dev server, real SSE consumer
 * over `fetch`, collecting BOTH raw `"reload"` string frames and `{ type:
 * "hmr", ... }` JSON frames. Also proves the Studio HTML carries the dev
 * bootstrap, and (via start.test.js's START-03) that `nexus start` never
 * mounts this endpoint.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join, dirname } from "path"
import Test, { assert } from "../../src/core/Test.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

const scratch = mkdtempSync(join(tmpdir(), "nexus-deve-"))
spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
const instance = join(scratch, "shop")
let server = null
let base = null

async function ensure() {
    if (base) return base
    server = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: instance })
    base = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev did not start")), 6000)
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

// collects `data:` frames as RAW strings — "reload" arrives as a bare string,
// { type: "hmr", ... } arrives as a JSON string; callers parse as needed.
async function rawSseConsumer(url) {
    const controller = new AbortController()
    const res = await fetch(url, { headers: { accept: "text/event-stream" }, signal: controller.signal })
    const frames = []
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
                    if (frame.startsWith("data:")) frames.push(frame.slice(5))
                }
            }
        } catch { /* aborted */ }
    })()
    return { frames, stop: () => controller.abort(), status: res.status }
}
const until = async (fn, ms = 15000) => { const t0 = Date.now(); while (!fn() && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 200)); return fn() }

Test.describe("Dev event stream (DEVE)", () => {
    Test.it("DEVE-01 /__dev_events exists in dev and broadcasts reload on a schema write", async () => {
        const c = await rawSseConsumer((await ensure()) + "/__dev_events")
        const r = await post("/_studio/model", { name: "live_probe", fields: [{ name: "x", type: "text" }] })
        assert.equal(r.body.ok, true)
        assert.truthy(await until(() => c.frames.some((f) => f === "reload")))
        c.stop()
    })

    Test.it("DEVE-02 an apps/ file change arrives as a plain reload frame (apps/ is not browser-served); framework /_nexus paths are fetchable", async () => {
        const c = await rawSseConsumer((await ensure()) + "/__dev_events")
        // the dev server watches the INSTANCE's apps/ dir — touch a template file there.
        // apps/ has no HTTP route (SEC discipline), so this is a full reload, not an hmr swap.
        const file = join(instance, "apps", "starter", "probe", "template.js")
        mkdirSync(dirname(file), { recursive: true })
        writeFileSync(file, "export default null")
        assert.truthy(await until(() => c.frames.some((f) => f === "reload")))
        c.stop()
        // pins the /_nexus/src/studio/... scheme framework hmr paths use: it must actually be fetchable
        const r = await fetch((await ensure()) + "/_nexus/src/studio/app.js")
        assert.equal(r.status, 200)
    })

    Test.it("DEVE-03 the served Studio HTML carries the dev bootstrap; and only in dev", async () => {
        const html = await (await fetch((await ensure()) + "/")).text()
        assert.truthy(html.includes("__dev_events") || html.includes("HMR/client.js")) // bootstrap injected
        assert.truthy(html.includes("_dev")) // the flag the client checks
    })

    Test.it("DEVE-99 cleanup", async () => {
        if (server) await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        assert.equal(true, true)
    })
})
