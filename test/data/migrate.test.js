/**
 * Data Plane conformance — MIGRATION ENGINE (MIG-*).
 *
 * The hybrid model of §4.4, exercised end-to-end on a real SQLite engine:
 * hot DDL for what the dialect can truly do live, the universal rebuild for
 * structural change (dry-run default, transaction, ledger, renames), and
 * loud refusal for everything in between.
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import { plan, hotApply, migrationPlan, applyMigration, appliedMigrations } from "../../src/core/Data/migrate.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { schema, field } from "../conformance/model/_helpers.js"

const kysely = createCompiler("sqlite")

/** The minimal executor contract over the real engine. */
function makeExecutor(entity) {
    const db = new DatabaseSync(":memory:")
    if (entity) for (const builder of tableDDL(kysely, entity)) db.exec(builder.compile().sql)
    return {
        db,
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: (sql, params = []) => db.prepare(sql).all(...params)
    }
}

const BASE = () =>
    schema({
        fields: [
            field("full_name", "text", { required: true }),
            field("tier", "select", { options: ["bronze", "silver", "gold"] }),
            field("age", "integer")
        ]
    })

const columns = (ex, table) => ex.all(`PRAGMA table_info(${table})`).map((c) => c.name)
const indexNames = (ex, table) =>
    ex.all(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`, [table]).map((r) => r.name)

Test.describe("Data Plane — Migration Engine (MIG-*)", () => {
    Test.it("MIG-01 plan separates hot, deferred and structural — and validates its inputs", () => {
        const next = BASE()
        next.fields.push(field("nick", "text"))
        const hotPlan = plan(kysely, BASE(), next)
        assert.equal(hotPlan.isHot, true)
        assert.equal(hotPlan.structural.length, 0)
        assert.truthy(hotPlan.hot[0].statements[0].sql.toLowerCase().includes("alter table"))

        const breaking = BASE()
        breaking.fields = breaking.fields.filter((f) => f.name !== "age")
        const structuralPlan = plan(kysely, BASE(), breaking)
        assert.equal(structuralPlan.isHot, false)
        assert.equal(structuralPlan.structural[0].field, "age")

        assert.throws(() => plan(kysely, BASE(), { schemaVersion: 1 }), "E_INVALID")
        assert.throws(() => plan(kysely, BASE(), schema({ name: "other" })), "E_ENTITY")
        assert.throws(() => plan(kysely, BASE(), BASE(), { dialect: "oracle" }), "E_DIALECT")
    })

    Test.it("MIG-02 hotApply adds columns live — existing rows receive the default", async () => {
        const ex = makeExecutor(BASE())
        ex.run(`INSERT INTO customer (id, full_name) VALUES ('01A', 'alice')`)
        const next = BASE()
        next.fields.push(field("nick", "text"))
        next.fields.push(field("status", "text", { required: true, default: "new" }))
        const result = await hotApply(ex, kysely, BASE(), next)
        assert.equal(result.statements, 2)
        const row = ex.all(`SELECT * FROM customer`)[0]
        assert.equal(row.nick, null)
        assert.equal(row.status, "new")
    })

    Test.it("MIG-03 hotApply creates and drops indexes live", async () => {
        const withIndex = BASE()
        withIndex.indexes = [{ fields: ["tier", "age"] }]
        const ex = makeExecutor(BASE())
        await hotApply(ex, kysely, BASE(), withIndex)
        assert.truthy(indexNames(ex, "customer").includes("idx_customer_tier_age"))
        await hotApply(ex, kysely, withIndex, BASE())
        assert.falsy(indexNames(ex, "customer").includes("idx_customer_tier_age"))
    })

    Test.it("MIG-04 metadata-only changes are hot with zero DDL", async () => {
        const ex = makeExecutor(BASE())
        const next = BASE()
        next.label = { en: "Client" }
        next.fields[1].options = ["bronze", "silver", "gold", "vip"] // extend select
        const result = await hotApply(ex, kysely, BASE(), next)
        assert.equal(result.statements, 0)
        assert.truthy(result.applied >= 2)
    })

    Test.it("MIG-05 hotApply refuses: structural → E_STRUCTURAL; sqlite-unhot → E_NOT_HOT", async () => {
        const ex = makeExecutor(BASE())
        const dropped = BASE()
        dropped.fields = dropped.fields.filter((f) => f.name !== "age")
        await Test.assert.rejects(hotApply(ex, kysely, BASE(), dropped), "E_STRUCTURAL")

        const loosened = BASE()
        loosened.fields[0].required = false // additive semantics, but sqlite cannot drop NOT NULL live
        await Test.assert.rejects(hotApply(ex, kysely, BASE(), loosened), "E_NOT_HOT")
    })

    Test.it("MIG-06 migrationPlan is deterministic, embeds both schemas, validates renames", () => {
        const next = BASE()
        next.fields = next.fields.map((f) => (f.name === "age" ? field("years", "integer") : f))
        const a = migrationPlan(BASE(), next, { renames: { age: "years" } })
        const b = migrationPlan(BASE(), next, { renames: { age: "years" } })
        assert.equal(a.id, b.id)
        assert.equal(a.entity, "customer")
        assert.deepEqual(a.from, BASE())
        assert.notEqual(a.id, migrationPlan(BASE(), next).id) // renames change identity
        assert.throws(() => migrationPlan(BASE(), next, { renames: { ghost: "years" } }), "E_RENAME")
    })

    Test.it("MIG-07 dry-run measures impact and rolls back — the table is untouched", async () => {
        const ex = makeExecutor(BASE())
        ex.run(`INSERT INTO customer (id, full_name, age) VALUES ('01A', 'alice', 30)`)
        ex.run(`INSERT INTO customer (id, full_name, age) VALUES ('01B', 'bob', NULL)`)
        const dropped = BASE()
        dropped.fields = dropped.fields.filter((f) => f.name !== "age")
        const result = await applyMigration(ex, kysely, migrationPlan(BASE(), dropped))
        assert.equal(result.dryRun, true)
        assert.equal(result.report.copied, 2)
        assert.equal(result.report.lost.age, 1) // one non-null age would be lost
        assert.truthy(columns(ex, "customer").includes("age"), "dry-run must roll back")
        assert.deepEqual(await appliedMigrations(ex), [])
    })

    Test.it("MIG-08 a real apply rebuilds, records the ledger, and never re-runs", async () => {
        const ex = makeExecutor(BASE())
        ex.run(`INSERT INTO customer (id, full_name, age) VALUES ('01A', 'alice', 30)`)
        const dropped = BASE()
        dropped.fields = dropped.fields.filter((f) => f.name !== "age")
        const migration = migrationPlan(BASE(), dropped)
        const result = await applyMigration(ex, kysely, migration, { dryRun: false })
        assert.equal(result.dryRun, false)
        assert.falsy(columns(ex, "customer").includes("age"))
        assert.equal(ex.all(`SELECT full_name FROM customer`)[0].full_name, "alice")
        const ledger = await appliedMigrations(ex)
        assert.equal(ledger.length, 1)
        assert.equal(ledger[0].id, migration.id)
        const again = await applyMigration(ex, kysely, migration, { dryRun: false })
        assert.equal(again.alreadyApplied, true)
    })

    Test.it("MIG-09 renames preserve the data that drop+add would lose", async () => {
        const next = BASE()
        next.fields = next.fields.map((f) => (f.name === "age" ? field("years", "integer") : f))

        const plain = makeExecutor(BASE())
        plain.run(`INSERT INTO customer (id, full_name, age) VALUES ('01A', 'alice', 30)`)
        const withoutRename = await applyMigration(plain, kysely, migrationPlan(BASE(), next), { dryRun: false })
        assert.equal(withoutRename.report.lost.age, 1)
        assert.equal(plain.all(`SELECT years FROM customer`)[0].years, null)

        const renamed = makeExecutor(BASE())
        renamed.run(`INSERT INTO customer (id, full_name, age) VALUES ('01A', 'alice', 30)`)
        const withRename = await applyMigration(renamed, kysely, migrationPlan(BASE(), next, { renames: { age: "years" } }), { dryRun: false })
        assert.deepEqual(withRename.report.lost, {})
        assert.equal(renamed.all(`SELECT years FROM customer`)[0].years, 30)
    })

    Test.it("MIG-10 a failing apply rolls back completely — table intact, ledger empty", async () => {
        const ex = makeExecutor(BASE())
        ex.run(`INSERT INTO customer (id, full_name, age) VALUES ('01A', 'alice', NULL)`)
        const tightened = BASE()
        tightened.fields[2] = field("age", "integer", { required: true }) // NULL row will violate the copy
        const migration = migrationPlan(BASE(), tightened)
        await Test.assert.rejects(applyMigration(ex, kysely, migration, { dryRun: false }), "NOT NULL")
        assert.truthy(columns(ex, "customer").includes("age"), "original table must survive")
        assert.equal(ex.all(`SELECT COUNT(*) AS n FROM customer`)[0].n, 1)
        assert.deepEqual(await appliedMigrations(ex), [])
    })

    Test.it("MIG-NOTX a non-transactional-DDL dialect refuses the structural path and runs NO DDL", async () => {
        const dropped = BASE()
        dropped.fields = dropped.fields.filter((f) => f.name !== "age")
        const migration = migrationPlan(BASE(), dropped)
        const ran = []
        const executor = {
            run: async (sql) => {
                ran.push(sql)
                return { rows: [] }
            },
            all: async () => []
        }
        let threw = null
        try {
            await applyMigration(executor, kysely, migration, { dialect: "mysql", dryRun: true })
        } catch (e) {
            threw = e
        }
        assert.truthy(String(threw?.message).startsWith("E_NO_TRANSACTIONAL_DDL"))
        assert.equal(ran.length, 0, "not one statement may run — the old code DROPPED the table here")
    })
})
