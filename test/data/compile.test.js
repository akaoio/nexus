/**
 * Data Plane conformance — AST→KYSELY COMPILER (CMP-*).
 *
 * THE GOLDEN INVARIANT: for any resolved, valid AST document, rows selected
 * by the compiled SQL on a real engine ≡ rows kept by the reference JS
 * predicate — byte-for-byte on ids. Verified here against a REAL SQLite
 * engine (node:sqlite, built into Node ≥22 — zero dependencies), over hand
 * fixtures for every operator, the pinned NOT-over-null case, and the
 * seeded random generators shared with AST-Q.
 *
 * Boolean bindings are coerced to 1/0 at the harness edge — exactly what
 * the sqlite adapter layer will do (SQLite has no boolean storage class).
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import * as AST from "../../src/core/AST.js"
import { toWhere, applyWhere } from "../../src/core/Data/compile.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { doc, leaf, and, or, not, prng, randomNode, randomRow, ROWS } from "../conformance/ast/_helpers.js"

// ─── Harness: real SQLite, one table, JS rows mirrored in ────────────────────

const COLUMNS = ["tier", "age", "active", "name", "owner", "score", "created", "s"]
const toBinding = (v) => (v === true ? 1 : v === false ? 0 : v === undefined ? null : v)

function makeDb(rows) {
    const db = new DatabaseSync(":memory:")
    db.exec(`CREATE TABLE t (id INTEGER PRIMARY KEY, tier TEXT, age INTEGER, active INTEGER, name TEXT, owner TEXT, score INTEGER, created TEXT, s TEXT)`)
    const insert = db.prepare(`INSERT INTO t (id, ${COLUMNS.join(", ")}) VALUES (?, ${COLUMNS.map(() => "?").join(", ")})`)
    for (const row of rows) insert.run(row.id, ...COLUMNS.map((c) => toBinding(row[c])))
    return db
}

/** ids per the compiled SQL on the real engine. */
function sqlIds(db, document) {
    const query = applyWhere(createCompiler("sqlite").selectFrom("t").select("id"), document)
    const { sql, parameters } = query.compile()
    return db.prepare(sql).all(...parameters.map(toBinding)).map((r) => r.id).sort((a, b) => a - b)
}

/** ids per the reference JS predicate. */
const jsIds = (rows, document) => rows.filter(AST.predicate(document)).map((r) => r.id).sort((a, b) => a - b)

const agree = (db, rows, document, label) =>
    assert.deepEqual(sqlIds(db, document), jsIds(rows, document), label || JSON.stringify(document.root))

Test.describe("Data Plane — AST→Kysely compiler (CMP-*)", () => {
    Test.it("CMP-01 toWhere compiles to parameterized SQL — values never inline", () => {
        const document = doc(leaf("name", "eq", "'; DROP TABLE t; --"))
        const { sql, parameters } = createCompiler("sqlite").selectFrom("t").select("id").where(toWhere(document)).compile()
        assert.equal(sql.includes("DROP TABLE"), false)
        assert.deepEqual([...parameters], ["'; DROP TABLE t; --"])
        // And on a real engine: matches nothing, harms nothing
        const db = makeDb(ROWS)
        assert.deepEqual(sqlIds(db, document), [])
        assert.equal(db.prepare("SELECT COUNT(*) AS n FROM t").get().n, ROWS.length)
    })

    Test.it("CMP-02 match-all: applyWhere leaves the builder untouched; toWhere refuses with E_EMPTY", () => {
        const bare = createCompiler("sqlite").selectFrom("t").select("id")
        assert.equal(applyWhere(bare, doc(null)).compile().sql, bare.compile().sql)
        assert.throws(() => toWhere(doc(null)), "E_EMPTY")
    })

    Test.it("CMP-03 invalid, unresolved, unknown-dialect and pathed documents are rejected loudly", () => {
        assert.throws(() => toWhere(doc({ op: "xor", children: [] })), "E_INVALID")
        assert.throws(() => toWhere(doc(leaf("owner", "eq", "$CURRENT_USER"))), "E_UNRESOLVED")
        assert.throws(() => toWhere(doc(leaf("a", "eq", 1)), { dialect: "oracle" }), "E_DIALECT")
        const compiled = toWhere(doc(leaf("contacts.email", "eq", "x")))
        assert.throws(() => createCompiler("sqlite").selectFrom("t").select("id").where(compiled).compile(), "E_PATH")
    })

    Test.it("CMP-04 every operator agrees with the reference predicate on the null-laden fixture", () => {
        const rows = [
            ...ROWS,
            { id: 6, name: "100%", s: "100%", created: "2026-06-15" },
            { id: 7, name: "a_b", s: "a_b", created: "2025-12-31" },
            { id: 8, name: "ALICE", tier: "gold", age: 30 }
        ]
        const db = makeDb(rows)
        const cases = [
            leaf("tier", "eq", "gold"),
            leaf("tier", "ne", "gold"),
            leaf("age", "gt", 30),
            leaf("age", "gte", 30),
            leaf("age", "lt", 30),
            leaf("age", "lte", 30),
            leaf("tier", "in", ["gold", "bronze"]),
            leaf("tier", "nin", ["gold", "bronze"]),
            leaf("age", "between", [18, 45]),
            leaf("name", "like", "%li%"),
            leaf("name", "like", "alice"), // case-insensitive: matches ALICE too
            leaf("name", "nlike", "%a%"),
            leaf("s", "like", "100\\%"), // escaped % — literal percent
            leaf("s", "like", "a\\_b"), // escaped _ — literal underscore
            leaf("created", "gte", "2026-01-01"), // ISO date ordering as strings
            leaf("score", "isnull"),
            leaf("score", "notnull"),
            leaf("active", "eq", true),
            leaf("active", "ne", true)
        ]
        for (const node of cases) agree(db, rows, doc(node))
    })

    Test.it("CMP-05 NOT over null comparisons matches the reference — the two-valued proof (AST-P04)", () => {
        const db = makeDb(ROWS)
        // Row 4 has tier NULL: naive SQL NOT(tier='gold') drops it; the
        // reference keeps it. The compiled form must keep it too.
        agree(db, ROWS, doc(not(leaf("tier", "eq", "gold"))))
        assert.deepEqual(sqlIds(db, doc(not(leaf("tier", "eq", "gold")))), [2, 3, 4])
        // And doubly-wrapped negations stay exact
        agree(db, ROWS, doc(not(not(leaf("tier", "eq", "gold")))))
        agree(db, ROWS, doc(not(leaf("score", "isnull"))))
    })

    Test.it("CMP-06 deep and/or/not composition agrees (AST-P05 shape)", () => {
        const db = makeDb(ROWS)
        const node = and(
            or(leaf("tier", "eq", "gold"), leaf("tier", "eq", "silver")),
            not(leaf("age", "lt", 40)),
            leaf("name", "notnull")
        )
        agree(db, ROWS, doc(node))
        assert.deepEqual(sqlIds(db, doc(node)), [2, 5])
    })

    Test.it("CMP-07 GOLDEN INVARIANT: seeded random documents × random rows — SQL ≡ predicate", () => {
        const rnd = prng(0x601d)
        const rows = []
        for (let i = 0; i < 60; i++) rows.push({ id: 1000 + i, ...randomRow(rnd) })
        const db = makeDb(rows)
        for (let i = 0; i < 120; i++) {
            const document = doc(randomNode(rnd))
            agree(db, rows, document, `seed doc #${i}: ${JSON.stringify(document.root)}`)
        }
    })

    Test.it("CMP-08 dialects: postgres compiles ILIKE; sqlite carries ESCAPE; turso ≡ sqlite", () => {
        const document = doc(leaf("name", "like", "%a%"))
        const compile = (dialect) =>
            applyWhere(createCompiler(dialect).selectFrom("t").select("id"), document, { dialect }).compile().sql
        const sqlite = compile("sqlite")
        assert.truthy(/escape/i.test(sqlite), "sqlite LIKE must carry an explicit ESCAPE clause")
        assert.truthy(/ilike/i.test(compile("postgres")), "postgres must compile ILIKE for case-insensitivity")
        assert.truthy(/like/i.test(compile("mysql")))
        assert.equal(compile("turso"), sqlite)
    })

    Test.it("CMP-09 permission injection carries through to SQL — inject then compile agrees", () => {
        const db = makeDb(ROWS)
        const query = doc(or(leaf("tier", "eq", "gold"), leaf("tier", "eq", "silver")))
        const permission = doc(leaf("owner", "eq", "u2"))
        const injected = AST.inject(query, permission)
        agree(db, ROWS, injected)
        assert.deepEqual(sqlIds(db, injected), [2, 5])
    })
})
