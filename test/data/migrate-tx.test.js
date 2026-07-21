/**
 * Migration Engine transaction envelopes (MIG-HOTTX-*) — issue #9 I9.
 *
 * `hotApply` used to loop compiled DDL statements with no envelope, so a
 * failure partway (statement 2 of 3) left the table between states with no
 * ledger entry to say so.
 *
 * The deliberate asymmetry with the entity-delete cascade (LIFE-TX-03, which
 * REFUSES on a non-transactional-DDL engine) is the point of MIG-HOTTX-02 and
 * is worth naming rather than looking inconsistent: entity delete is
 * DESTRUCTIVE, so a half-done cascade loses data and refusing costs the
 * operator a different route and nothing else. Hot apply is ADDITIVE by
 * construction — plan() defers everything that is not an added column or
 * index — so a half-done change loses nothing, and refusing would mean MySQL
 * instances could not add a field at all. The honest answer is to do the work
 * and report the weaker guarantee, not to hide it and not to withdraw it.
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import { plan, hotApply } from "../../src/core/Data/migrate.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { handleTransaction } from "../../src/core/Data/transaction.js"
import { schema, field } from "../conformance/model/_helpers.js"

const kysely = createCompiler("sqlite")

function makeExecutor(entity) {
    const db = new DatabaseSync(":memory:")
    if (entity) for (const builder of tableDDL(kysely, entity)) db.exec(builder.compile().sql)
    const run = (sql, params = []) => void db.prepare(sql).run(...params)
    const all = (sql, params = []) => db.prepare(sql).all(...params)
    return { db, run, all, transaction: handleTransaction(run, all, "BEGIN IMMEDIATE") }
}

const BASE = () => schema({ fields: [field("full_name", "text", { required: true })] })
const columns = (ex, table) => ex.all(`PRAGMA table_info(${table})`).map((c) => c.name)

Test.describe("Migration Engine transaction envelopes (MIG-HOTTX)", () => {

    Test.it("MIG-HOTTX-01 a hot apply whose SECOND statement fails leaves the table exactly as it was — no half-added column", async () => {
        const ex = makeExecutor(BASE())
        const next = schema({ fields: [...BASE().fields, field("alpha", "text"), field("beta", "text")] })

        // Two ADD COLUMNs, in that order — verified, so the clause genuinely
        // exercises "statement 1 succeeded, statement 2 failed" rather than
        // passing trivially because the first one blew up.
        const p = plan(kysely, BASE(), next)
        const sql = p.hot.flatMap((h) => h.statements).map((s) => s.sql)
        assert.equal(sql.length, 2)
        assert.truthy(sql[0].includes("alpha"), `expected alpha first, got: ${sql.join(" | ")}`)
        assert.truthy(sql[1].includes("beta"), `expected beta second, got: ${sql.join(" | ")}`)

        // Make statement 2 fail for a real engine reason: beta already exists.
        ex.run(`ALTER TABLE customer ADD COLUMN beta TEXT`)
        const before = columns(ex, "customer")

        await assert.rejects(hotApply(ex, kysely, BASE(), next, {}))

        assert.deepEqual(columns(ex, "customer"), before, "the successful first statement must have been rolled back with the failed second")
        assert.falsy(columns(ex, "customer").includes("alpha"), "alpha must not survive a failed apply")
    })

    Test.it("MIG-HOTTX-02 a non-transactional-DDL engine still gets its additive change, and is TOLD the guarantee is weaker", async () => {
        // MySQL implicitly COMMITs on DDL (C5), so there is no envelope to be
        // had. Driven with a recording executor because the point is the code
        // path and the declared result, not MySQL's own behaviour.
        const issued = []
        const ex = {
            run: async (sql) => void issued.push(sql),
            all: async () => [],
            transaction: () => { throw new Error("a non-transactional-DDL engine must never be asked for an envelope") }
        }
        const mysqlKysely = createCompiler("mysql")
        const next = schema({ fields: [...BASE().fields, field("alpha", "text")] })

        const result = await hotApply(ex, mysqlKysely, BASE(), next, { dialect: "mysql" })

        assert.equal(result.atomic, false, "the weaker guarantee must be REPORTED, not hidden")
        assert.equal(result.statements, 1, "and the work must still have been done")
        assert.truthy(issued.some((s) => s.includes("alpha")))
    })

    Test.it("MIG-HOTTX-03 a transactional engine reports atomic: true, and the additive change lands", async () => {
        const ex = makeExecutor(BASE())
        const next = schema({ fields: [...BASE().fields, field("alpha", "text")] })
        const result = await hotApply(ex, kysely, BASE(), next, {})
        assert.equal(result.atomic, true)
        assert.truthy(columns(ex, "customer").includes("alpha"))
    })
})
