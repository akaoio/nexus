/**
 * App system conformance — EXTENSION POINTS (EXT-*).
 *
 * The App API v1 plug surface: hooks into the Data Plane (mutate/veto/
 * observe), endpoints into HTTP's "_" namespace, commands into the CLI —
 * plus loadExtensions wiring real hooks.js modules from disk. E2E clauses
 * ride the scaffolded starter app through the real dev server and CLI.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import Extensions, { loadExtensions, HOOK_EVENTS } from "../../src/core/App/extensions.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { schema, field } from "../conformance/model/_helpers.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))
const TASK = schema({ name: "task", fields: [field("title", "text", { required: true }), field("done", "boolean", { default: false })] })
const policy = { entity: "task", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false }
const CTX = { user: "u1", roles: [], policies: [policy], shares: [] }

async function makePlane(extensions) {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const builder of tableDDL(kysely, TASK)) db.exec(builder.compile().sql)
    const executor = {
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: (sql, params = []) => db.prepare(sql).all(...params)
    }
    return new DataPlane({ executor, schemas: [TASK], dialect: "sqlite", hooks: extensions })
}

Test.describe("App system — extension points (EXT-*)", () => {
    Test.it("EXT-01 the registry validates its inputs loudly; the event set is closed", () => {
        const ext = new Extensions()
        assert.deepEqual([...HOOK_EVENTS], [
            "before:create", "after:create", "before:update", "after:update", "before:remove", "after:remove"
        ])
        assert.throws(() => ext.hook("task", "before:read", () => {}), "E_HOOK_EVENT")
        assert.throws(() => ext.endpoint("PUT", "x", () => {}), "E_ENDPOINT_METHOD")
        assert.throws(() => ext.command("Bad Name", { run: () => {} }), "E_COMMAND_NAME")
        ext.endpoint("GET", "stats", () => ({}))
        assert.throws(() => ext.endpoint("GET", "stats", () => ({})), "E_ENDPOINT_CONFLICT")
        ext.command("hello", { run: () => {} })
        assert.throws(() => ext.command("hello", { run: () => {} }), "E_COMMAND_CONFLICT")
    })

    Test.it("EXT-02 before-hooks mutate the payload; after-hooks observe — through the real Data Plane", async () => {
        const ext = new Extensions()
        const seen = []
        ext.hook("task", "before:create", (payload) => {
            payload.data.title = payload.data.title.trim()
        })
        ext.hook("task", "after:create", (payload) => seen.push(payload.row.title))
        const plane = await makePlane(ext)
        const row = await plane.create("task", { title: "  padded  " }, CTX)
        assert.equal(row.title, "padded")
        assert.deepEqual(seen, ["padded"])
    })

    Test.it("EXT-03 a throwing before-hook VETOES the write — nothing persists", async () => {
        const ext = new Extensions()
        ext.hook("task", "before:create", (payload) => {
            if (payload.data.title === "forbidden") throw new Error("E_VETO: not on my watch")
        })
        const plane = await makePlane(ext)
        await Test.assert.rejects(plane.create("task", { title: "forbidden" }, CTX), "E_VETO")
        assert.deepEqual(await plane.list("task", {}, CTX), [])
        const ok = await plane.create("task", { title: "allowed" }, CTX)
        assert.equal(ok.title, "allowed")
    })

    Test.it("EXT-04 update and remove ride their hooks too, in order", async () => {
        const ext = new Extensions()
        const order = []
        for (const event of HOOK_EVENTS) ext.hook("task", event, () => order.push(event))
        const plane = await makePlane(ext)
        const row = await plane.create("task", { title: "x" }, CTX)
        await plane.update("task", row.id, { done: true }, CTX)
        await plane.remove("task", row.id, CTX)
        assert.deepEqual(order, [...HOOK_EVENTS])
    })

    Test.it("EXT-05 loadExtensions wires hooks.js modules from disk; bad exports are loud", async () => {
        const root = mkdtempSync(join(tmpdir(), "nexus-ext-"))
        mkdirSync(join(root, "apps", "one"), { recursive: true })
        writeFileSync(
            join(root, "apps", "one", "hooks.js"),
            `export default ({ command }) => command("ping", { run: ({ out }) => out.print("pong") })`
        )
        const ext = await loadExtensions(root, [{ dir: "one" }])
        assert.truthy(ext.commands.has("ping"))

        mkdirSync(join(root, "apps", "two"), { recursive: true })
        writeFileSync(join(root, "apps", "two", "hooks.js"), `export const nothing = true`)
        await Test.assert.rejects(loadExtensions(root, [{ dir: "two" }]), "E_HOOKS_EXPORT")
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("EXT-06 E2E: the starter app's hook, endpoint and command work through dev + CLI", async () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-ext-e2e-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const instance = join(scratch, "shop")

        // command through the real CLI fall-through
        const hello = spawnSync(process.execPath, [BIN, "hello"], { cwd: instance, encoding: "utf8" })
        assert.equal(hello.status, 0)
        assert.equal(hello.stdout.trim(), "hello from starter")

        // hook + endpoint through the real dev server
        const dev = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: instance })
        try {
            const base = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("dev did not start")), 5000)
                let buffer = ""
                dev.stdout.on("data", (chunk) => {
                    buffer += chunk
                    try {
                        clearTimeout(timer)
                        resolve(JSON.parse(buffer).url)
                    } catch {}
                })
                dev.on("exit", () => reject(new Error("dev exited early")))
            })
            const created = await (
                await fetch(`${base}/api/v1/task`, {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ title: "  trimmed by hook  " })
                })
            ).json()
            assert.equal(created.data.title, "trimmed by hook")

            const stats = await (await fetch(`${base}/api/v1/_/stats`)).json()
            assert.deepEqual(stats, { ok: true, data: { total: 1, done: 0 } })

            const missing = await fetch(`${base}/api/v1/_/ghost`)
            assert.equal(missing.status, 404)
        } finally {
            await new Promise((resolve) => { dev.once("exit", resolve); dev.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })
})
