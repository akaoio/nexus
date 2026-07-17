/**
 * Data Plane conformance — ENGINE ADAPTERS (ADP-*).
 *
 * The executor contract behind real drivers. The sqlite adapter (node:sqlite,
 * built-in) is pinned fully here — contract, persistence, and a full
 * Data Plane stack ride. turso/postgres/mysql adapters follow their drivers'
 * published APIs; here their E_DRIVER guidance paths are pinned, and their
 * live behavior is pinned in the multi-engine CI matrix (real services).
 */

import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { createExecutor, ENGINES, engineDialect } from "../../src/core/Data/adapters.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { schema, field } from "../conformance/model/_helpers.js"

const TASK = schema({
    name: "task",
    fields: [field("title", "text", { required: true }), field("done", "boolean", { default: false })]
})

const policy = { entity: "task", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false }
const CTX = { user: "u1", roles: [], policies: [policy], shares: [] }

async function ensureTables(executor) {
    const kysely = createCompiler(executor.dialect)
    for (const builder of tableDDL(kysely, TASK, { dialect: executor.dialect }))
        await executor.run(builder.compile().sql, [])
}

Test.describe("Data Plane — engine adapters (ADP-*)", () => {
    Test.it("ADP-01 the engine set matches the dialect set; unknown engines are rejected loudly", async () => {
        assert.deepEqual([...ENGINES].sort(), ["mysql", "postgres", "sqlite", "turso"])
        for (const engine of ENGINES) assert.equal(engineDialect(engine), engine)
        await Test.assert.rejects(createExecutor("oracle"), "E_ENGINE")
    })

    Test.it("ADP-02 the sqlite adapter satisfies the executor contract on the built-in engine", async () => {
        const executor = await createExecutor("sqlite")
        assert.equal(executor.dialect, "sqlite")
        await executor.run("CREATE TABLE t (a INTEGER, b TEXT)")
        await executor.run("INSERT INTO t (a, b) VALUES (?, ?)", [1, "x"])
        const rows = await executor.all("SELECT * FROM t WHERE a = ?", [1])
        assert.deepEqual(rows, [{ a: 1, b: "x" }])
        executor.close()
    })

    Test.it("ADP-03 the sqlite adapter persists to a file across reopen", async () => {
        const dir = mkdtempSync(join(tmpdir(), "nexus-adp-"))
        const path = join(dir, "data.db")
        const first = await createExecutor("sqlite", { path })
        await first.run("CREATE TABLE t (a TEXT)")
        await first.run("INSERT INTO t (a) VALUES (?)", ["persisted"])
        first.close()
        const second = await createExecutor("sqlite", { path })
        assert.deepEqual(await second.all("SELECT a FROM t"), [{ a: "persisted" }])
        second.close()
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("ADP-04 the full Data Plane stack rides an adapter unchanged", async () => {
        const executor = await createExecutor("sqlite")
        await ensureTables(executor)
        const plane = new DataPlane({ executor, schemas: [TASK], dialect: executor.dialect })
        const created = await plane.create("task", { title: "via adapter" }, CTX)
        const listed = await plane.list("task", {}, CTX)
        assert.equal(listed.length, 1)
        assert.equal(listed[0].done, false) // normalized boolean through the same path
        await plane.remove("task", created.id, CTX)
        assert.deepEqual(await plane.list("task", {}, CTX), [])
        executor.close()
    })

    Test.it("ADP-05 missing drivers fail with the exact install command — never a cryptic module error", async () => {
        // These drivers are intentionally NOT installed here (user-chosen, N2);
        // live adapter behavior is pinned in the multi-engine CI matrix.
        const cases = [
            ["turso", "@tursodatabase/database"],
            ["postgres", "pg"],
            ["mysql", "mysql2"]
        ]
        for (const [engine, pkg] of cases) {
            const error = await Test.assert.rejects(createExecutor(engine, { root: tmpdir() }))
            assert.truthy(error.message.startsWith("E_DRIVER"), `${engine}: ${error.message}`)
            assert.truthy(error.message.includes(`npm install ${pkg}`), `${engine} must name its install command`)
        }
    })
})
