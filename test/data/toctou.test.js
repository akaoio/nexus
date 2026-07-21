/**
 * Time-of-check / time-of-use on writes (DPL-TOCTOU-*) — issue #9's TOCTOU
 * moderate.
 *
 * The permission check ran as a SELECT with the row rule injected, and then
 * the UPDATE/DELETE was keyed on `id` ALONE. Between the two, the row can
 * change so it no longer satisfies the rule the caller was authorized under —
 * and the write lands anyway, on a row the caller may no longer touch.
 *
 * The transaction (BEGIN IMMEDIATE, TXN-04) closes the window on sqlite by
 * serialising writers. These clauses pin the OTHER half, which is what
 * survives a weaker isolation level: the write statement carries the
 * permission predicate itself, so a row that moved out of scope simply does
 * not match. The race is simulated precisely rather than hoped for — the
 * executor mutates the row at the exact instant between the check and the use.
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { handleTransaction } from "../../src/core/Data/transaction.js"
import { schema, field } from "../conformance/model/_helpers.js"

const TASK = schema({ name: "task", fields: [field("title", "text", { required: true })] })
const policy = { entity: "task", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: true }
const CTX = { user: "u1", roles: [], policies: [policy], shares: [] }

/**
 * A plane whose executor can be told to steal a row — reassign its owner —
 * the moment the permission pre-image has been read. That is exactly the
 * instant a concurrent writer would strike.
 */
function makeRacingPlane() {
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const builder of tableDDL(kysely, TASK)) db.exec(builder.compile().sql)

    let stealAfterSelect = null
    const run = (sql, params = []) => void db.prepare(sql).run(...params)
    const all = (sql, params = []) => {
        const rows = db.prepare(sql).all(...params)
        if (stealAfterSelect && /^select/i.test(sql.trim()) && rows.length) {
            const victim = stealAfterSelect
            stealAfterSelect = null // strike exactly once, between check and use
            db.prepare(`UPDATE task SET owner = ? WHERE id = ?`).run("u2", victim)
        }
        return rows
    }
    const executor = { run, all, transaction: handleTransaction(run, all, "BEGIN IMMEDIATE") }
    const plane = new DataPlane({ executor, schemas: [TASK], dialect: "sqlite", now: () => "2026-07-21T00:00:00.000Z" })
    return { plane, db, steal: (id) => { stealAfterSelect = id } }
}

Test.describe("Write-path TOCTOU (DPL-TOCTOU)", () => {

    Test.it("DPL-TOCTOU-01 an UPDATE cannot land on a row that left the caller's permission scope after the check", async () => {
        const { plane, db, steal } = makeRacingPlane()
        const created = await plane.create("task", { title: "mine" }, CTX)

        steal(created.id) // another writer reassigns the row the instant it is read
        await assert.rejects(plane.update("task", created.id, { title: "changed" }, CTX), "E_NOT_FOUND")

        // Same opacity as a genuinely missing row — no new error channel, and
        // no existence leak that would tell the caller "it exists, but not for
        // you". And crucially: the write did NOT happen.
        const [row] = db.prepare(`SELECT title, owner FROM task WHERE id = ?`).all(created.id)
        assert.equal(row.title, "mine", "the stolen row must be untouched")
        assert.equal(row.owner, "u2")
    })

    Test.it("DPL-TOCTOU-02 a DELETE cannot land on a row that left the caller's permission scope after the check", async () => {
        const { plane, db, steal } = makeRacingPlane()
        const created = await plane.create("task", { title: "mine" }, CTX)

        steal(created.id)
        await assert.rejects(plane.remove("task", created.id, CTX), "E_NOT_FOUND")

        assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM task WHERE id = ?`).all(created.id)[0].n, 1, "the stolen row must survive")
    })

    Test.it("DPL-TOCTOU-03 with no race, update and remove still work exactly as before — the guard narrows nothing it should not", async () => {
        const { plane, db } = makeRacingPlane()
        const a = await plane.create("task", { title: "a" }, CTX)
        const b = await plane.create("task", { title: "b" }, CTX)

        const patched = await plane.update("task", a.id, { title: "a2" }, CTX)
        assert.equal(patched.title, "a2")
        assert.equal(await plane.remove("task", b.id, CTX), true)
        assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM task`).all()[0].n, 1)
    })
})
