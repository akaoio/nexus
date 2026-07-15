/**
 * Data Plane conformance — MODEL→DDL COMPILER (DDL-*).
 *
 * Entity schemas become real tables: executed against node:sqlite (the real
 * engine, zero dependencies), with per-dialect type mapping pinned compile-
 * only. DDL-08 closes the first full vertical: schema → CREATE TABLE →
 * INSERT → AST-compiled WHERE ≡ reference predicate.
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/kernel/Test.js"
import { tableDDL, columnType } from "../../src/data/ddl.js"
import { createCompiler } from "../../src/data/kysely.js"
import { applyWhere } from "../../src/data/compile.js"
import * as AST from "../../src/ast/AST.js"
import { schema, field } from "../conformance/model/_helpers.js"
import { doc, leaf, and } from "../conformance/ast/_helpers.js"

const kysely = createCompiler("sqlite")

/** Compile the DDL and execute it on a fresh real SQLite database. */
function realize(entity) {
    const db = new DatabaseSync(":memory:")
    for (const builder of tableDDL(kysely, entity)) db.exec(builder.compile().sql)
    return db
}

const columns = (db, table) => db.prepare(`PRAGMA table_info(${table})`).all()
const indexes = (db, table) =>
    db.prepare(`SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = ?`).all(table).map((r) => r.name)

Test.describe("Data Plane — Model→DDL compiler (DDL-*)", () => {
    Test.it("DDL-01 a valid schema compiles; invalid schemas and dialects are rejected loudly", () => {
        const builders = tableDDL(kysely, schema())
        assert.truthy(builders.length >= 1)
        assert.truthy(builders[0].compile().sql.toLowerCase().startsWith("create table"))
        assert.truthy(builders[0].compile().sql.includes('"customer"'))
        assert.throws(() => tableDDL(kysely, { schemaVersion: 1 }), "E_INVALID")
        assert.throws(() => tableDDL(kysely, schema(), { dialect: "oracle" }), "E_DIALECT")
        assert.throws(() => columnType("teleport"), "E_TYPE")
    })

    Test.it("DDL-02 the DDL executes on a real engine and declares every non-table field", () => {
        const db = realize(schema())
        const names = columns(db, "customer").map((c) => c.name)
        for (const expected of ["full_name", "tier", "age", "active", "manager"])
            assert.truthy(names.includes(expected), `column ${expected}`)
        assert.falsy(names.includes("contacts"), "table fields must NOT become columns (DDL-05)")
    })

    Test.it("DDL-03 system columns ride on every entity: id TEXT PRIMARY KEY, owner, created_at, updated_at", () => {
        const db = realize(schema({ fields: [] })) // zero declared fields
        const info = columns(db, "customer")
        const byName = Object.fromEntries(info.map((c) => [c.name, c]))
        assert.deepEqual(Object.keys(byName).sort(), ["created_at", "id", "owner", "updated_at"])
        assert.equal(byName.id.pk, 1)
        assert.equal(byName.id.type.toLowerCase(), "text")
        assert.equal(byName.id.notnull, 1)
    })

    Test.it("DDL-04 required → NOT NULL, default → applied, unique → enforced — on the real engine", () => {
        const entity = schema({
            fields: [
                field("title", "text", { required: true }),
                field("done", "boolean", { default: false }),
                field("code", "text", { unique: true }),
                field("priority", "select", { options: ["low", "high"], default: "low" })
            ]
        })
        const db = realize(entity)
        const insert = (id, title, code) =>
            db.prepare("INSERT INTO customer (id, title, code) VALUES (?, ?, ?)").run(id, title, code)

        insert("01A", "hello", "C1")
        const row = db.prepare("SELECT * FROM customer WHERE id = '01A'").get()
        assert.equal(row.done, 0) // boolean default false → 0 in sqlite storage
        assert.equal(row.priority, "low")
        assert.throws(() => insert("01B", null, "C2"), "NOT NULL")
        assert.throws(() => insert("01C", "dup code", "C1"), "UNIQUE")
    })

    Test.it("DDL-06 declared indexes and automatic link indexes exist on the real engine", () => {
        const db = realize(schema({ indexes: [{ fields: ["tier", "age"] }] }))
        const names = indexes(db, "customer")
        assert.truthy(names.includes("idx_customer_tier_age"), "declared composite index")
        assert.truthy(names.includes("idx_customer_manager"), "automatic index on the link field")
    })

    Test.it("DDL-07 type mapping is dialect-aware; turso DDL ≡ sqlite DDL", () => {
        assert.equal(columnType("boolean", "sqlite"), "integer")
        assert.equal(columnType("boolean", "postgres"), "boolean")
        assert.equal(columnType("text", "mysql"), "varchar(255)")
        assert.equal(columnType("number", "postgres"), "double precision")
        assert.equal(columnType("datetime", "sqlite"), "text")
        assert.equal(columnType("datetime", "postgres"), "timestamptz")
        const sql = (dialect) =>
            tableDDL(createCompiler(dialect), schema(), { dialect }).map((b) => b.compile().sql)
        assert.deepEqual(sql("turso"), sql("sqlite"))
        assert.truthy(sql("postgres")[0].includes("boolean"))
        assert.truthy(sql("mysql")[0].includes("varchar(255)"))
    })

    Test.it("DDL-09 link fields carry no DB-level foreign key — CRDT folds out of order by design", () => {
        const create = tableDDL(kysely, schema())[0].compile().sql
        assert.equal(/references/i.test(create), false)
        // and an orphan link value inserts cleanly (update-before-create must fold)
        const db = realize(schema())
        db.prepare("INSERT INTO customer (id, full_name, manager) VALUES ('01A', 'x', 'GHOST-ULID')").run()
        assert.equal(db.prepare("SELECT manager FROM customer WHERE id = '01A'").get().manager, "GHOST-ULID")
    })

    Test.it("DDL-08 FULL VERTICAL: schema → DDL → insert → AST query ≡ reference predicate", () => {
        const entity = schema({
            name: "task",
            fields: [
                field("title", "text", { required: true }),
                field("done", "boolean", { default: false }),
                field("priority", "select", { options: ["low", "medium", "high"], default: "medium" }),
                field("points", "integer")
            ]
        })
        const db = realize(entity)
        const rows = [
            { id: "01", title: "ship kernel", done: true, priority: "high", points: 8 },
            { id: "02", title: "write ddl", done: false, priority: "high", points: 5 },
            { id: "03", title: "rest", done: false, priority: "low", points: null },
            { id: "04", title: "review", done: true, priority: "medium", points: 3 }
        ]
        const insert = db.prepare("INSERT INTO task (id, title, done, priority, points) VALUES (?, ?, ?, ?, ?)")
        for (const r of rows) insert.run(r.id, r.title, r.done ? 1 : 0, r.priority, r.points)

        const query = doc(and(leaf("done", "eq", false), leaf("priority", "in", ["high", "medium"])))
        const compiled = applyWhere(createCompiler("sqlite").selectFrom("task").select("id"), query).compile()
        const sqlIds = db.prepare(compiled.sql).all(...compiled.parameters.map((v) => (v === false ? 0 : v === true ? 1 : v))).map((r) => r.id)
        const jsIds = rows.filter(AST.predicate(query)).map((r) => r.id)
        assert.deepEqual(sqlIds.sort(), jsIds.sort())
        assert.deepEqual(sqlIds, ["02"])
    })
})
