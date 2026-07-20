/**
 * Policy window ≡ engine (POLWIN-*) — design 2026-07-19 §7. A real dev
 * server with auth ON (two API keys): a grant that exists only in an app
 * FILE and one that exists only in ROWS are both enforced through
 * /api/v1 — and the row grant goes live with NO restart (hook refresh).
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, mkdirSync, rmSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

const scratch = mkdtempSync(join(tmpdir(), "nexus-polwin-"))
spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
const instance = join(scratch, "shop")
// auth ON from boot: two API keys; a FILE baseline grants viewer read on task
const cfgPath = join(instance, "nexus.config.json")
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"))
cfg.api_keys = [
    { key: "admin-key-0123456789abcdef", user: "root", roles: ["admin"] },
    { key: "viewer-key-0123456789abcde", user: "eye", roles: ["viewer"] }
]
writeFileSync(cfgPath, JSON.stringify(cfg, null, 4))
mkdirSync(join(instance, "apps", "starter", "permissions"), { recursive: true })
writeFileSync(join(instance, "apps", "starter", "permissions", "base.json"),
    JSON.stringify([{ entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: false, roles: ["viewer"] }]))

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
const call = async (key, method, path, body) => {
    const r = await fetch((await ensure()) + path, {
        method,
        headers: { "content-type": "application/json", "x-nexus-key": key },
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: r.status, body: await r.json() }
}
const ADMIN = "admin-key-0123456789abcdef"
const VIEWER = "viewer-key-0123456789abcde"

Test.describe("Policy window ≡ engine (POLWIN)", () => {
    Test.it("POLWIN-01 a FILE-layer grant is enforced; everything ungranted stays denied (deny-by-default)", async () => {
        const read = await call(VIEWER, "POST", "/api/v1/task/query", { filter: null, limit: 10 })
        assert.equal(read.body.ok, true) // base.json grants viewer read
        const create = await call(VIEWER, "POST", "/api/v1/task", { title: "nope" })
        assert.equal(create.body.ok, false) // nothing grants viewer create
    })

    Test.it("POLWIN-02 a ROWS-layer grant goes live with NO restart and composes additively with the file layer", async () => {
        const grant = await call(ADMIN, "POST", "/api/v1/nexus_policy", {
            entity: "task", actions: JSON.stringify(["create"]), rule: null,
            permlevel: 0, ifowner: false, roles: JSON.stringify(["viewer"])
        })
        assert.equal(grant.body.ok, true)
        const create = await call(VIEWER, "POST", "/api/v1/task", { title: "granted by a row" })
        assert.equal(create.body.ok, true) // hot: hook-refresh, no restart
        const read = await call(VIEWER, "POST", "/api/v1/task/query", { filter: null, limit: 10 })
        assert.equal(read.body.ok, true) // the file grant still holds — additive union
        const del = await call(VIEWER, "DELETE", "/api/v1/task/" + create.body.data.id)
        assert.equal(del.body.ok, false) // still nothing grants delete
    })

    Test.it("POLWIN-03 the layer view is a normal API route: admin sees the layers, a viewer is refused", async () => {
        const asAdmin = await call(ADMIN, "GET", "/api/v1/_policy-layers")
        assert.equal(asAdmin.body.ok, true)
        const sources = asAdmin.body.data.layers.map((l) => l.source)
        assert.truthy(sources.includes("system") && sources.includes("admin") && sources.includes("rows"))
        const asViewer = await call(VIEWER, "GET", "/api/v1/_policy-layers")
        assert.equal(asViewer.body.ok, false)
        assert.equal(asViewer.body.error.code, "E_FORBIDDEN")
    })

    Test.it("POLWIN-99 cleanup", async () => {
        if (server) await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        assert.equal(true, true)
    })
})
