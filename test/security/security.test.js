/**
 * Security conformance (SEC-*) — a pentester's findings, each pinned as a
 * clause so a regression re-opens the hole loudly. Written to assert the
 * SECURE behavior; they were red against the pre-fix code.
 */

import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/kernel/Test.js"
import { DataPlane } from "../../src/data/DataPlane.js"
import { tableDDL } from "../../src/data/ddl.js"
import { createCompiler } from "../../src/data/kysely.js"
import { timingSafeStringEqual } from "../../src/cli/output.js"
import { doc, leaf } from "../conformance/ast/_helpers.js"
import { schema, field } from "../conformance/model/_helpers.js"

const BIN = new URL("../../bin/nexus.js", import.meta.url).pathname

// ── the dev server, booted once with a secret in its config ──────────────────
const scratch = mkdtempSync(join(tmpdir(), "nexus-sec-"))
const INSTANCE = join(scratch, "shop")
let server = null
let base = null

async function ensureServer() {
    if (base) return base
    spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
    const configPath = join(INSTANCE, "nexus.config.json")
    const config = JSON.parse(readFileSync(configPath, "utf8"))
    config.api_keys = [{ key: "SECRET-KEY-do-not-leak", user: "admin", roles: ["admin"] }]
    writeFileSync(configPath, JSON.stringify(config, null, 2))
    writeFileSync(join(INSTANCE, "backup-secret.json"), JSON.stringify({ backupVersion: 1, data: { secret: "dump" } }))
    server = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: INSTANCE })
    base = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev did not start")), 5000)
        let buffer = ""
        server.stdout.on("data", (chunk) => {
            buffer += chunk
            try {
                clearTimeout(timer)
                resolve(JSON.parse(buffer).url)
            } catch {}
        })
        server.on("exit", () => reject(new Error("dev exited early")))
    })
    return base
}

const status = async (path) => (await fetch((await ensureServer()) + path)).status
const body = async (path) => (await fetch((await ensureServer()) + path)).text()

Test.describe("Security (SEC-*)", () => {
    Test.it("SEC-01 CRITICAL: the dev server never serves nexus.config.json (API keys)", async () => {
        assert.equal(await status("/nexus.config.json"), 404)
        assert.equal((await body("/nexus.config.json")).includes("SECRET-KEY"), false)
    })

    Test.it("SEC-02 the dev server never serves .nexus/ (the raw database) or any dotdir", async () => {
        assert.equal(await status("/.nexus/data.db"), 404)
        assert.equal(await status("/.nexus/schemas.json"), 404)
    })

    Test.it("SEC-03 the dev server never serves backups, app source, or dotfiles at the root", async () => {
        assert.equal(await status("/backup-secret.json"), 404)
        assert.equal(await status("/apps/starter/hooks.js"), 404)
        assert.equal(await status("/package.json"), 404)
    })

    Test.it("SEC-04 static serving is confined to public/ — a placed asset IS reachable", async () => {
        const { mkdirSync, writeFileSync: wf } = await import("fs")
        mkdirSync(join(INSTANCE, "public"), { recursive: true })
        wf(join(INSTANCE, "public", "logo.txt"), "hello")
        assert.equal(await status("/logo.txt"), 200)
        assert.equal((await body("/logo.txt")).trim(), "hello")
        // and traversal out of public/ still cannot reach the config
        assert.equal(await status("/..%2fnexus.config.json"), 404)
    })

    Test.it("SEC-05 list() clamps limit to a hard max — no unbounded result-set DoS", async () => {
        const { DatabaseSync } = await import("node:sqlite")
        const TASK = schema({ name: "task", fields: [field("title", "text")] })
        const db = new DatabaseSync(":memory:")
        const kysely = createCompiler("sqlite")
        for (const b of tableDDL(kysely, TASK)) db.exec(b.compile().sql)
        const executor = { run: (s, p = []) => void db.prepare(s).run(...p), all: (s, p = []) => db.prepare(s).all(...p) }
        const plane = new DataPlane({ executor, schemas: [TASK], dialect: "sqlite" })
        const ctx = { user: "u", roles: [], policies: [{ entity: "task", actions: ["read", "create"], rule: null, permlevel: 0, ifOwner: false }], shares: [] }
        for (let i = 0; i < 60; i++) await plane.create("task", { title: `t${i}` }, ctx)
        const capped = await plane.list("task", { limit: 1e9 }, ctx)
        assert.inRange(capped.length, 0, DataPlane.MAX_LIMIT)
        assert.equal(capped.length, DataPlane.MAX_LIMIT < 60 ? DataPlane.MAX_LIMIT : 60)
        const defaulted = await plane.list("task", {}, ctx)
        assert.inRange(defaulted.length, 0, DataPlane.MAX_LIMIT)
    })

    Test.it("SEC-06 API-key comparison is length-independent constant-time, and correct", () => {
        assert.equal(timingSafeStringEqual("abc", "abc"), true)
        assert.equal(timingSafeStringEqual("abc", "abd"), false)
        assert.equal(timingSafeStringEqual("abc", "abcd"), false) // length differs — no throw, no leak
        assert.equal(timingSafeStringEqual("", ""), true)
        assert.equal(timingSafeStringEqual("x", undefined), false)
        assert.equal(timingSafeStringEqual(undefined, "x"), false)
    })

    Test.it("SEC-07 a pathological LIKE pattern cannot hang the predicate (ReDoS bound)", async () => {
        const AST = await import("../../src/ast/AST.js")
        const evil = "%".repeat(40) + "x"
        const predicate = AST.predicate(doc(leaf("s", "like", evil)))
        const start = Date.now()
        assert.equal(predicate({ s: "a".repeat(5000) }), false) // no 'x' — worst case for backtracking
        assert.truthy(Date.now() - start < 1000, "must finish well under a second")
    })

    Test.it("SEC-99 cleanup", () => {
        if (server) server.kill()
        rmSync(scratch, { recursive: true, force: true })
        assert.equal(true, true)
    })
})
