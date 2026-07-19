/**
 * Studio write endpoints conformance (STUDIO-*) — the dev-only /_studio routes
 * that persist a content type or permission set edited in the admin UI. Schema
 * editing is a DEV activity (Strapi parity); `nexus start` never exposes these.
 * Spawned as a real dev server; the write is verified on disk.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, existsSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { validate } from "../../src/core/Model.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

const scratch = mkdtempSync(join(tmpdir(), "nexus-studio-"))
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
const patch = async (path, body) => {
    const r = await fetch((await ensure()) + path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    return { status: r.status, body: await r.json() }
}

Test.describe("Studio write endpoints (STUDIO)", () => {
    Test.it("STUDIO-01 POST /_studio/model persists a valid, validated content type", async () => {
        const r = await post("/_studio/model", { name: "customer", fields: [{ name: "email", type: "text", required: true }] })
        assert.equal(r.status, 200)
        assert.equal(r.body.ok, true)
        const file = join(instance, "apps", "starter", "models", "customer.json")
        assert.truthy(existsSync(file), "the model file is written to the app")
        const saved = JSON.parse(readFileSync(file, "utf8"))
        assert.equal(saved.name, "customer")
        assert.equal(validate(saved).valid, true) // what we persist is a valid Model Schema v1
    })

    Test.it("STUDIO-02 an invalid collection name is rejected (E_NAME), nothing written", async () => {
        const r = await post("/_studio/model", { name: "Bad Name!", fields: [] })
        assert.equal(r.status, 400)
        assert.equal(r.body.ok, false)
        assert.equal(r.body.error.code, "E_NAME")
        assert.falsy(existsSync(join(instance, "apps", "starter", "models", "Bad Name!.json")))
    })

    Test.it("STUDIO-03 an invalid schema is rejected (E_INVALID) by the Model API", async () => {
        const r = await post("/_studio/model", { name: "broken", fields: [{ name: "x", type: "not_a_type" }] })
        assert.equal(r.status, 400)
        assert.equal(r.body.error.code, "E_INVALID")
    })

    Test.it("STUDIO-04 the bespoke permissions write path is DEAD — /_studio/permissions 404s both ways", async () => {
        const g = await fetch((await ensure()) + "/_studio/permissions")
        assert.equal(g.status, 404)
        const p = await post("/_studio/permissions", { policies: [] })
        assert.equal(p.status, 404)
    })

    Test.it("STUDIO-05 /_studio/config reads (redacted) and writes a dot-path", async () => {
        await post("/_studio/config", { key: "token_secret", value: "sekret" }) // seed a secret
        const got = await post("/_studio/config", { key: "site.locale", value: "vi" })
        assert.equal(got.status, 200)
        assert.equal(got.body.ok, true)
        const cfg = JSON.parse(readFileSync(join(instance, "nexus.config.json"), "utf8"))
        assert.equal(cfg.site.locale, "vi")
        // GET is redacted
        const list = await (await fetch((await ensure()) + "/_studio/config")).json()
        assert.equal(list.data.config.token_secret, "***")
    })

    Test.it("STUDIO-06 GET /_studio/policies is the engine's own layers; a row created via the plane appears under rows", async () => {
        const created = await post("/api/v1/nexus_policy", {
            entity: "task", actions: JSON.stringify(["read"]), rule: null,
            permlevel: 0, ifowner: false, roles: JSON.stringify(["viewer"])
        })
        assert.equal(created.body.ok, true)
        const id = created.body.data.id
        const w = await fetch((await ensure()) + "/_studio/policies").then((r) => r.json())
        assert.equal(w.ok, true)
        const sources = w.data.layers.map((l) => l.source)
        assert.truthy(sources.includes("system") && sources.includes("admin") && sources.includes("rows"))
        const rows = w.data.layers.find((l) => l.source === "rows")
        assert.equal(rows.readonly, false)
        assert.truthy(rows.policies.some((p) => p.id === id && p.entity === "task"))
        for (const layer of w.data.layers) if (layer.source !== "rows") assert.equal(layer.readonly, true)
        assert.equal(typeof w.data.devMode, "boolean")
    })

    Test.it("STUDIO-07 an invalid nexus_policy row is VETOED at the plane — same law for every writer", async () => {
        const bad = await post("/api/v1/nexus_policy", { entity: "task", actions: JSON.stringify(["fly"]), rule: null, permlevel: 0, ifowner: false })
        assert.equal(bad.body.ok, false)
        assert.equal(bad.body.error.code, "E_INVALID")
        const broken = await post("/api/v1/nexus_policy", { entity: "task", actions: "{not json", rule: null, permlevel: 0, ifowner: false })
        assert.equal(broken.body.ok, false)

        // the UPDATE before-hook validates the MERGED row (current + patch),
        // not the patch alone — same law, proven through the other write path
        const valid = await post("/api/v1/nexus_policy", { entity: "task", actions: JSON.stringify(["read"]), rule: null, permlevel: 0, ifowner: false })
        assert.equal(valid.body.ok, true)
        const rowId = valid.body.data.id
        const vetoed = await patch(`/api/v1/nexus_policy/${rowId}`, { actions: JSON.stringify(["fly"]) })
        assert.equal(vetoed.body.ok, false)
        assert.equal(vetoed.body.error.code, "E_INVALID")
        const allowed = await patch(`/api/v1/nexus_policy/${rowId}`, { actions: JSON.stringify(["read", "create"]) })
        assert.equal(allowed.body.ok, true)
    })

    Test.it("STUDIO-99 cleanup", async () => {
        if (server) await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        assert.equal(true, true)
    })
})
