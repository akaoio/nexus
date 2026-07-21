/**
 * Entity delete is one transaction, and it stops swallowing errors
 * (LIFE-TX-*) — issue #9 I8.
 *
 * The cascade ran as a bare sequence in dev.js: policy rows, view rows, then
 * per link — rewrite the schema FILE, then `ALTER TABLE … DROP COLUMN` inside
 * `try {} catch {}` — then an embeddings delete (also swallowed), `DROP TABLE`,
 * and `rmSync`. No transaction, and two silent catches.
 *
 * The worst of it was the ordering: the schema file was rewritten to drop the
 * link field BEFORE the DROP COLUMN that might silently fail. When it did, the
 * file said the field was gone and the table said it was not — a permanent,
 * invisible schema/DB divergence that nothing later reconciles.
 *
 * These clauses exist in core rather than against the dev server for a reason
 * the coverage map already recorded: dev.js is imported by no test, so the
 * destructive path was untestable in-process. Moving the executor beside the
 * pure plan it performs is what makes it assertable at all.
 */

import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { entityDeletePlan, applyEntityDelete } from "../../src/core/App/lifecycle.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { handleTransaction } from "../../src/core/Data/transaction.js"

const kysely = createCompiler("sqlite")

const TARGET = {
    schemaVersion: 1,
    name: "widget",
    label: { en: "Widget" },
    fields: [{ name: "title", type: "text", label: { en: "T" } }]
}
// An entity holding a link INTO the target — its column is what must drop.
const HOLDER = {
    schemaVersion: 1,
    name: "crate",
    label: { en: "Crate" },
    fields: [
        { name: "name", type: "text", label: { en: "N" } },
        { name: "widget", type: "link", target: "widget", label: { en: "W" } }
    ]
}
const POLICY = {
    schemaVersion: 1,
    name: "nexus_policy",
    label: { en: "Policy" },
    fields: [{ name: "entity", type: "text", label: { en: "E" } }]
}
const VIEW = {
    schemaVersion: 1,
    name: "nexus_view",
    label: { en: "View" },
    fields: [{ name: "entity", type: "text", label: { en: "E" } }]
}

function setup() {
    const root = mkdtempSync(join(tmpdir(), "nexus-life-"))
    mkdirSync(join(root, "apps", "demo", "models"), { recursive: true })
    const files = { widget: "apps/demo/models/widget.json", crate: "apps/demo/models/crate.json" }
    writeFileSync(join(root, files.widget), JSON.stringify(TARGET, null, 4))
    writeFileSync(join(root, files.crate), JSON.stringify(HOLDER, null, 4))

    const db = new DatabaseSync(":memory:")
    for (const s of [TARGET, HOLDER, POLICY, VIEW]) for (const b of tableDDL(kysely, s)) db.exec(b.compile().sql)
    db.exec(`INSERT INTO nexus_policy (id, entity) VALUES ('p1', 'widget'), ('p2', 'other')`)
    db.exec(`INSERT INTO nexus_view (id, entity) VALUES ('v1', 'widget')`)
    db.exec(`INSERT INTO widget (id, title) VALUES ('w1', 'x')`)

    const run = (sql, params = []) => void db.prepare(sql).run(...params)
    const all = (sql, params = []) => db.prepare(sql).all(...params)
    const executor = { run, all, transaction: handleTransaction(run, all, "BEGIN IMMEDIATE") }

    const plan = entityDeletePlan({
        target: "widget",
        schemas: [{ schema: TARGET, file: files.widget }, { schema: HOLDER, file: files.crate }],
        rowCount: 1,
        dbPolicyRows: [{ id: "p1", entity: "widget" }, { id: "p2", entity: "other" }],
        baselinePolicies: [],
        viewRows: [{ id: "v1", entity: "widget" }]
    })
    return { root, db, executor, plan, files, cleanup: () => rmSync(root, { recursive: true, force: true }) }
}

const tables = (db) => db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all().map((r) => r.name)
const columns = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name)
const count = (db, t, where = "") => db.prepare(`SELECT COUNT(*) AS n FROM ${t} ${where}`).all()[0].n

Test.describe("Entity delete is atomic (LIFE-TX)", () => {

    Test.it("LIFE-TX-04 the happy path performs EXACTLY what the plan named — and nothing else", async () => {
        const { root, db, executor, plan, files, cleanup } = setup()

        await applyEntityDelete({ executor, root, plan, dialect: "sqlite" })

        assert.falsy(tables(db).includes("widget"), "the table goes")
        assert.equal(count(db, "nexus_policy"), 1, "only the target's policy row goes")
        assert.equal(count(db, "nexus_policy", `WHERE id = 'p2'`), 1, "an unrelated policy row survives")
        assert.equal(count(db, "nexus_view"), 0)
        assert.falsy(columns(db, "crate").includes("widget"), "the link column drops")
        assert.truthy(columns(db, "crate").includes("name"), "and nothing else does")

        assert.falsy(existsSync(join(root, files.widget)), "the schema file goes")
        const crate = JSON.parse(readFileSync(join(root, files.crate), "utf8"))
        assert.deepEqual(crate.fields.map((f) => f.name), ["name"], "the holder's schema file loses only the link field")
        cleanup()
    })

    Test.it("LIFE-TX-01 a DROP COLUMN that fails mid-cascade rolls the whole cascade back — nothing is left half-deleted", async () => {
        const { root, db, executor, plan, cleanup } = setup()
        // The column the plan names is gone from the table but not the plan —
        // exactly the divergence the old swallowed catch would have created,
        // used here to make the DDL fail for a real engine reason. (Its index
        // goes first, because sqlite will not drop a column one references —
        // the very constraint that made the old cascade fail every time.)
        db.exec(`DROP INDEX IF EXISTS idx_crate_widget`)
        db.exec(`ALTER TABLE crate DROP COLUMN widget`)

        await assert.rejects(applyEntityDelete({ executor, root, plan, dialect: "sqlite" }))

        assert.truthy(tables(db).includes("widget"), "the target table must survive a failed cascade")
        assert.equal(count(db, "widget"), 1, "and so must its rows")
        assert.equal(count(db, "nexus_policy"), 2, "policy rows deleted earlier in the cascade must come back")
        assert.equal(count(db, "nexus_view"), 1, "and so must view rows")
        cleanup()
    })

    Test.it("LIFE-TX-02 when the database work fails, NO schema file has been written or removed", async () => {
        const { root, db, executor, plan, files, cleanup } = setup()
        const before = {
            widget: readFileSync(join(root, files.widget), "utf8"),
            crate: readFileSync(join(root, files.crate), "utf8")
        }
        db.exec(`DROP INDEX IF EXISTS idx_crate_widget`)
        db.exec(`ALTER TABLE crate DROP COLUMN widget`)

        await assert.rejects(applyEntityDelete({ executor, root, plan, dialect: "sqlite" }))

        assert.truthy(existsSync(join(root, files.widget)), "the target's schema file must still be there")
        assert.equal(readFileSync(join(root, files.widget), "utf8"), before.widget)
        assert.equal(readFileSync(join(root, files.crate), "utf8"), before.crate, "the holder's file must not have been rewritten ahead of the DDL")
        cleanup()
    })

    Test.it("LIFE-TX-03 an engine whose DDL cannot roll back REFUSES before any statement runs", async () => {
        const { root, plan, files, cleanup } = setup()
        const issued = []
        const executor = {
            run: async (sql) => void issued.push(sql),
            all: async () => [],
            transaction: () => { throw new Error("must not even reach the transaction") }
        }

        await assert.rejects(applyEntityDelete({ executor, root, plan, dialect: "mysql" }), "E_NO_TRANSACTIONAL_DDL")

        assert.deepEqual(issued, [], "a half-done cascade loses data — refusing costs the operator another route and nothing else")
        assert.truthy(existsSync(join(root, files.widget)), "and nothing on disk moved either")
        cleanup()
    })

    Test.it("LIFE-TX-05 an instance that never embedded anything is handled by ASKING, not by swallowing every error", async () => {
        // The one legitimate tolerance in the old code was "_nexus_embeddings
        // may not exist". That is an existence question with an answer, so it
        // is asked — rather than wrapping the statement in a catch that would
        // equally hide a genuine failure.
        const { root, db, executor, plan, cleanup } = setup()
        assert.falsy(tables(db).includes("_nexus_embeddings"))

        await applyEntityDelete({ executor, root, plan, dialect: "sqlite" })

        assert.falsy(tables(db).includes("widget"))
        cleanup()
    })
})
