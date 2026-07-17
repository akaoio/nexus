/**
 * HTTP API conformance — the auto-generated Data Plane API (API-*).
 *
 * End-to-end: a real scaffolded instance, the real `nexus dev` process, and
 * real HTTP requests — the same contract internal apps and external clients
 * share (§5). The suite boots ONE server and drives full CRUD, the Query
 * AST endpoint, and the error-status contract through it.
 */

import { fileURLToPath } from "url"
import { spawn, spawnSync } from "child_process"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/kernel/Test.js"
import { doc, leaf, and } from "../conformance/ast/_helpers.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))
const scratch = mkdtempSync(join(tmpdir(), "nexus-api-"))
const INSTANCE = join(scratch, "shop")

let server = null
let base = null

async function ensureServer() {
    if (base) return base
    spawnSync(process.execPath, [BIN, "create", "shop", "--site", "API Shop"], { cwd: scratch })
    server = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: INSTANCE })
    base = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev server did not start")), 5000)
        let buffer = ""
        server.stdout.on("data", (chunk) => {
            buffer += chunk
            try {
                const data = JSON.parse(buffer)
                clearTimeout(timer)
                resolve(data.url)
            } catch { /* incomplete */ }
        })
        server.on("exit", () => reject(new Error("dev exited early")))
    })
    return base
}

async function call(method, path, body, headers = {}) {
    const url = (await ensureServer()) + path
    const response = await fetch(url, {
        method,
        headers: { "content-type": "application/json", ...headers },
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: response.status, body: await response.json() }
}

Test.describe("HTTP API — auto-generated from schemas (API-*)", () => {
    Test.it("API-01 the dev banner declares entities; list starts empty with 200", async () => {
        await ensureServer()
        const { status, body } = await call("GET", "/api/v1/task")
        assert.equal(status, 200)
        assert.deepEqual(body, { ok: true, data: [] })
    })

    Test.it("API-02 full CRUD round-trip over real HTTP", async () => {
        const created = await call("POST", "/api/v1/task", { title: "ship http", priority: "high" })
        assert.equal(created.status, 201)
        assert.equal(created.body.ok, true)
        const id = created.body.data.id
        assert.equal(id.length, 26)
        assert.equal(created.body.data.done, false) // default applied

        const got = await call("GET", `/api/v1/task/${id}`)
        assert.equal(got.status, 200)
        assert.equal(got.body.data.title, "ship http")

        const updated = await call("PATCH", `/api/v1/task/${id}`, { done: true })
        assert.equal(updated.status, 200)
        assert.equal(updated.body.data.done, true)

        const removed = await call("DELETE", `/api/v1/task/${id}`)
        assert.equal(removed.status, 200)
        assert.deepEqual(removed.body.data, { removed: true })

        const gone = await call("GET", `/api/v1/task/${id}`)
        assert.equal(gone.status, 404)
        assert.equal(gone.body.error.code, "E_NOT_FOUND")
    })

    Test.it("API-03 the query endpoint accepts a full Query AST document", async () => {
        for (const [title, priority, done] of [["a", "high", false], ["b", "low", false], ["c", "high", true]])
            await call("POST", "/api/v1/task", { title, priority, done })
        const { status, body } = await call("POST", "/api/v1/task/query", {
            filter: doc(and(leaf("priority", "eq", "high"), leaf("done", "eq", false))),
            orderBy: [{ field: "title" }]
        })
        assert.equal(status, 200)
        assert.deepEqual(body.data.map((r) => r.title), ["a"])
    })

    Test.it("API-04 list options ride query params: limit/offset/order", async () => {
        const { body } = await call("GET", "/api/v1/task?order=title:desc&limit=2")
        assert.equal(body.data.length, 2)
        const titles = body.data.map((r) => r.title)
        assert.deepEqual(titles, [...titles].sort().reverse())
    })

    Test.it("API-05 the error contract: 400 validation with code, 404 unknown entity, 400 bad JSON", async () => {
        const invalid = await call("POST", "/api/v1/task", { title: "x", priority: "urgent" })
        assert.equal(invalid.status, 400)
        assert.equal(invalid.body.error.code, "E_VALUE_OPTION")

        const ghost = await call("GET", "/api/v1/ghost")
        assert.equal(ghost.status, 404)
        assert.equal(ghost.body.error.code, "E_ENTITY")

        const badJson = await fetch((await ensureServer()) + "/api/v1/task", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{not json"
        })
        assert.equal(badJson.status, 400)
        assert.equal((await badJson.json()).error.code, "E_JSON")

        const badMethod = await call("PUT", "/api/v1/task")
        assert.equal(badMethod.status, 400)
        assert.equal(badMethod.body.error.code, "E_METHOD")
    })

    Test.it("API-06 x-nexus-user stamps ownership through the whole stack", async () => {
        const created = await call("POST", "/api/v1/task", { title: "alice's" }, { "x-nexus-user": "alice" })
        assert.equal(created.body.data.owner, "alice")
    })

    Test.it("API-07 static serving and the index page still ride alongside the API", async () => {
        const index = await fetch(await ensureServer())
        assert.equal(index.status, 200)
        const html = await index.text()
        assert.truthy(html.includes("API Shop"))
        assert.truthy(html.includes("<code>task</code>"), "the entity list names each entity")
        assert.truthy(html.includes("/api/v1/:entity/query"), "the API summary names the query endpoint")
        // SEC-01: the instance config (which may hold api_keys) is NOT served
        const config = await fetch((await ensureServer()) + "/nexus.config.json")
        assert.equal(config.status, 404)
    })

    Test.it("API-08 the shell loads the Studio app, which composes the served widgets", async () => {
        const base = await ensureServer()
        const html = await (await fetch(base)).text()
        // the shell is thin: it embeds boot data and loads the real app entry
        assert.truthy(html.includes("/_nexus/src/studio/app/app.js"), "the shell loads the Studio app")
        assert.truthy(html.includes('"name":"task"'), "schemas are embedded for the client")

        // the app entry is served and composes the widgets (imports the builder)
        const app = await fetch(`${base}/_nexus/src/studio/app/app.js`)
        assert.equal(app.status, 200)
        assert.truthy((await app.text()).includes("query-builder.js"), "app.js imports the widgets")
        // a widget + the kernel + the stylesheet are served
        assert.equal((await fetch(`${base}/_nexus/src/studio/query-builder.js`)).status, 200)
        assert.equal((await fetch(`${base}/_nexus/src/kernel/UI.js`)).status, 200)
        assert.equal((await fetch(`${base}/_nexus/src/studio/app/studio.css`)).status, 200)

        // Only src/ + vendor/ are exposed, and traversal cannot escape
        assert.equal((await fetch(`${base}/_nexus/package.json`)).status, 404)
        assert.equal((await fetch(`${base}/_nexus/src/..%2f..%2fpackage.json`)).status, 404)
    })

    Test.it("API-09 /_health is an unauthenticated liveness probe with a stable shape", async () => {
        const base = await ensureServer()
        const response = await fetch(base + "/_health")
        assert.equal(response.status, 200)
        const body = await response.json()
        assert.equal(body.ok, true)
        assert.equal(body.data.status, "ok")
        assert.truthy(Array.isArray(body.data.entities))
        assert.truthy(body.data.entities.includes("task"))
        assert.truthy(typeof body.data.engine === "string")
        assert.truthy(Number.isFinite(body.data.uptime))
    })

    Test.it("API-99 cleanup: stop the server, remove scratch", async () => {
        if (server) await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        assert.equal(true, true)
    })
})
