/**
 * Kernel conformance — SQL FACADE (KRN-SQ).
 *
 * The SQL class is a serialized dispatch layer over the "sql" worker thread.
 * These clauses pin the dispatch contract in Node by injecting a scripted
 * worker into the global Threads singleton (the same message protocol the
 * real WASM worker speaks). Real SQLite execution is pinned browser-side
 * once the vendored WASM build lands (Phase 2).
 */

import Test, { assert } from "../../src/kernel/Test.js"
import SQL from "../../src/kernel/SQL.js"
import { threads } from "../../src/kernel/Threads.js"

/** A scripted in-process "sql worker" speaking the Threads message protocol. */
function installFakeWorker(script) {
    const log = []
    threads.threads.sql = {
        postMessage(data) {
            log.push({ method: data.method, params: data.params, at: log.length })
            const reply = (payload) => threads.process({ queue: data.queue, ...payload }, "sql")
            setTimeout(() => script(data, reply), 0)
        }
    }
    return log
}

const uninstall = () => delete threads.threads.sql

Test.describe("Kernel — SQL facade (KRN-SQ)", () => {
    Test.it("KRN-SQ01 open dispatches on construction with the db name; ready resolves", async () => {
        const log = installFakeWorker((data, reply) => reply({ response: { ok: true } }))
        const db = new SQL({ name: "shopdb" })
        await db.ready
        assert.equal(log[0].method, "open")
        assert.equal(log[0].params.db, "shopdb")
        uninstall()
    })

    Test.it("KRN-SQ02 every query method injects the db name and forwards sql/params", async () => {
        const log = installFakeWorker((data, reply) => reply({ response: [] }))
        const db = new SQL({ name: "shopdb" })
        await db.ready
        await db.run("INSERT INTO t (x) VALUES (?)", [1])
        await db.get("SELECT * FROM t WHERE x = ?", [1])
        await db.all("SELECT * FROM t")
        await db.batch([{ sql: "DELETE FROM t", params: [] }])
        const methods = log.map((e) => e.method)
        assert.deepEqual(methods, ["open", "run", "get", "all", "batch"])
        for (const entry of log) assert.equal(entry.params.db, "shopdb")
        assert.equal(log[1].params.sql, "INSERT INTO t (x) VALUES (?)")
        assert.deepEqual(log[1].params.params, [1])
        assert.deepEqual(log[4].params.queries, [{ sql: "DELETE FROM t", params: [] }])
        uninstall()
    })

    Test.it("KRN-SQ03 dispatch is serialized — one in flight, strictly ordered", async () => {
        let firstReply = null
        const log = installFakeWorker((data, reply) => {
            // Hold the FIRST post-open call hostage; release later
            if (data.method === "run" && !firstReply) {
                firstReply = () => reply({ response: { changes: 1 } })
                return
            }
            reply({ response: [] })
        })
        const db = new SQL({ name: "s" })
        await db.ready
        const p1 = db.run("FIRST")
        const p2 = db.all("SECOND")
        await new Promise((r) => setTimeout(r, 30))
        assert.deepEqual(log.map((e) => e.method), ["open", "run"], "second call must wait for the first")
        firstReply()
        await p1
        await p2
        assert.deepEqual(log.map((e) => e.method), ["open", "run", "all"])
        uninstall()
    })

    Test.it("KRN-SQ04 worker errors reject the caller's promise with the message", async () => {
        installFakeWorker((data, reply) =>
            data.method === "open" ? reply({ response: { ok: true } }) : reply({ error: { message: "no such table: ghosts" } })
        )
        const db = new SQL({ name: "s" })
        await db.ready
        await Test.assert.rejects(db.get("SELECT * FROM ghosts"), "no such table")
        uninstall()
    })

    Test.it("KRN-SQ05 the facade exposes the full public surface", () => {
        installFakeWorker((data, reply) => reply({ response: { ok: true } }))
        const db = new SQL({ name: "s" })
        for (const method of ["exec", "run", "get", "all", "batch"]) assert.equal(typeof db[method], "function")
        assert.truthy(db.ready instanceof Promise)
        uninstall()
    })
})
