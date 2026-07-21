/**
 * The executor's transaction seam (TXN-*, ADP-TXN) — issue #9 follow-up
 * chunk 2, §1 of the durability design.
 *
 * Why this suite exists at all: placing the transaction boundaries I7/I8/I9
 * asked for surfaced that there was no transaction primitive to place them
 * with. The only transactional code in the tree improvised by sending literal
 * BEGIN/COMMIT/ROLLBACK strings through run(). That is correct on ONE handle
 * (node:sqlite, PGlite) and unsound on a POOL: pg and mysql2 hand out an
 * arbitrary idle client per query, so BEGIN, the body and COMMIT can each land
 * on a different connection — the BEGIN opens a transaction nobody commits,
 * the body runs outside any transaction, and the ROLLBACK rolls back nothing.
 *
 * TXN-02 is the clause that pins that, and it is deliberately driven with a
 * FAKE pool rather than a live cluster. A live-Postgres test would not have
 * caught it: the live Postgres clauses run against PGlite, which is
 * single-connection, so the one engine where the guarantee breaks is the one
 * the suite never exercises. Same shape as C5 (MySQL DDL), one layer down.
 */

import { unlinkSync, mkdtempSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { createExecutor, runTransaction, acquirePg, acquireMysql } from "../../src/core/Data/executor.js"
import { CAPABILITIES, capabilitiesFor, ENGINES } from "../../src/core/Data/adapters.js"

const tmp = () => join(mkdtempSync(join(tmpdir(), "nexus-txn-")), "t.db")

Test.describe("Executor transaction seam (TXN)", () => {

    Test.it("ADP-TXN every engine DECLARES its DML transaction support, and an unknown engine still fails closed", () => {
        for (const engine of ENGINES)
            assert.equal(capabilitiesFor(engine).transactions, true, `${engine} must declare transactions`)
        // DDL transactions stay a SEPARATE, narrower claim — MySQL implicitly
        // COMMITs on DDL (C5) and that must not be widened by this addition.
        assert.equal(CAPABILITIES.mysql.transactionalDDL, false)
        assert.equal(CAPABILITIES.sqlite.transactionalDDL, true)
        assert.throws(() => capabilitiesFor("nope"), "E_ENGINE")
    })

    Test.it("TXN-01 a callback that returns COMMITS and yields its value; one that throws ROLLS BACK and re-throws the ORIGINAL error", async () => {
        const ex = await createExecutor("sqlite", { path: ":memory:" })
        await ex.run(`CREATE TABLE t (id TEXT PRIMARY KEY)`)

        const value = await ex.transaction(async (tx) => {
            await tx.run(`INSERT INTO t (id) VALUES (?)`, ["kept"])
            return "returned"
        })
        assert.equal(value, "returned")
        assert.equal((await ex.all(`SELECT id FROM t`)).length, 1)

        const boom = new Error("E_APP: the callback's own failure")
        const caught = await assert.rejects(
            ex.transaction(async (tx) => {
                await tx.run(`INSERT INTO t (id) VALUES (?)`, ["rolled-back"])
                throw boom
            })
        )
        // The caller must see WHY it failed, not a rollback artefact.
        assert.equal(caught, boom)
        assert.equal((await ex.all(`SELECT id FROM t`)).length, 1, "the failed transaction left nothing behind")

        await ex.close()
    })

    Test.it("TXN-03 the tx handed to a callback cannot nest — no silent half-commit through a savepoint that does not exist", async () => {
        const ex = await createExecutor("sqlite", { path: ":memory:" })
        await assert.rejects(ex.transaction(async (tx) => { await tx.transaction(async () => {}) }), "E_NESTED_TX")
        await ex.close()
    })

    Test.it("TXN-04 sqlite takes its write lock UP FRONT (BEGIN IMMEDIATE) — a deferred transaction is not a TOCTOU fix", async () => {
        // Behavioural, not string-matching: hold a transaction open on one
        // connection and let a SECOND connection to the same file attempt a
        // write. Under BEGIN IMMEDIATE the write lock is already held, so the
        // second writer is refused at once. Under a bare (deferred) BEGIN that
        // has not written yet, it would succeed — which is exactly the window
        // a read-then-write transaction must not have.
        const path = tmp()
        const a = await createExecutor("sqlite", { path })
        const b = await createExecutor("sqlite", { path, busyTimeoutMs: 0 })
        await a.run(`CREATE TABLE t (id TEXT PRIMARY KEY)`)

        let secondWriterRefused = false
        await a.transaction(async (tx) => {
            await tx.run(`INSERT INTO t (id) VALUES (?)`, ["a"])
            try {
                await b.run(`INSERT INTO t (id) VALUES (?)`, ["b"])
            } catch {
                secondWriterRefused = true
            }
        })
        assert.truthy(secondWriterRefused, "a second writer must be locked out for the whole transaction")

        await a.close()
        await b.close()
        try { unlinkSync(path) } catch {}
    })

    Test.it("TXN-02 a POOLED driver runs the whole transaction on ONE connection, and releases it exactly once — including when the callback throws", async () => {
        // A fake pool in the shape of `pg`: connect() hands out a fresh,
        // distinguishable client each call. If the seam ever goes back to
        // pool.query() per statement, every statement lands on its own client
        // and this clause fails loudly.
        const served = []
        const releases = []
        let issued = 0
        const pool = {
            connect: async () => {
                const id = `client-${++issued}`
                return {
                    query: async (sql) => { served.push({ id, sql }); return { rows: [] } },
                    release: () => releases.push(id)
                }
            }
        }

        await runTransaction({ acquire: acquirePg(pool) }, async (tx) => {
            await tx.run("INSERT INTO t VALUES ($1)", ["x"])
            await tx.all("SELECT 1")
        })

        assert.equal(issued, 1, "one transaction must check out exactly one client")
        assert.equal(new Set(served.map((s) => s.id)).size, 1, "every statement must run on the SAME client")
        assert.deepEqual(served.map((s) => s.sql), ["BEGIN", "INSERT INTO t VALUES ($1)", "SELECT 1", "COMMIT"])
        assert.deepEqual(releases, ["client-1"], "the client is returned to the pool exactly once")

        // And on failure: still one client, still rolled back on it, still released once.
        served.length = 0
        releases.length = 0
        await assert.rejects(runTransaction({ acquire: acquirePg(pool) }, async () => { throw new Error("E_APP: boom") }), "E_APP")
        assert.deepEqual(served.map((s) => s.sql), ["BEGIN", "ROLLBACK"])
        assert.deepEqual(releases, ["client-2"], "a thrown callback must not leak the connection")
    })

    Test.it("TXN-02b the mysql2 pool shape gets the same guarantee — getConnection(), not pool.query() per statement", async () => {
        const served = []
        const releases = []
        let issued = 0
        const pool = {
            getConnection: async () => {
                const id = `conn-${++issued}`
                return {
                    query: async (sql) => { served.push({ id, sql }); return [[]] },
                    release: () => releases.push(id)
                }
            }
        }
        await runTransaction({ acquire: acquireMysql(pool) }, async (tx) => { await tx.run("INSERT INTO t VALUES (?)", ["x"]) })
        assert.equal(issued, 1)
        assert.equal(new Set(served.map((s) => s.id)).size, 1)
        assert.deepEqual(releases, ["conn-1"])
    })

    Test.it("TXN-05 a rollback that itself fails never REPLACES the error that caused it", async () => {
        const original = new Error("E_APP: the real cause")
        const acquire = async () => ({
            run: async (sql) => { if (sql === "ROLLBACK") throw new Error("connection already gone") },
            all: async () => [],
            release: () => {}
        })
        const caught = await assert.rejects(runTransaction({ acquire }, async () => { throw original }))
        assert.equal(caught, original, "the caller must still be told the real cause")
        assert.truthy(caught.message.includes("rollback"), "and told that the rollback also failed")
    })
})
