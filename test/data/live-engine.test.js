/**
 * Live engine conformance — the data plane on a REAL, non-sqlite engine
 * (LIVE-*). Turso (@tursodatabase/database) is in-process — no server — so
 * the "đa engine ngang hàng" claim is provable on this very machine, not
 * only in a cloud CI matrix.
 *
 * The driver is the INSTANCE's dependency, never Nexus's (N2) — it is
 * installed under test/.engines/ and resolved from there. When it is not
 * installed the clauses skip (like { browser: true }), so the suite stays
 * green everywhere while ACTUALLY running against Turso where it exists:
 *
 *   npm --prefix test/.engines install @tursodatabase/database
 *
 * Postgres/MySQL slot into the same harness the moment a local server +
 * driver are present (createExecutor already resolves them).
 */

import { fileURLToPath } from "url"
import Test, { assert } from "../../src/core/Test.js"
import { createExecutor } from "../../src/core/Data/executor.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { applyWhere } from "../../src/core/Data/compile.js"
import { plan, hotApply } from "../../src/core/Data/migrate.js"
import * as AST from "../../src/core/AST.js"
import { schema, field } from "../conformance/model/_helpers.js"
import { doc, and, or, prng, randomNode, randomRow } from "../conformance/ast/_helpers.js"

const ENGINES_ROOT = fileURLToPath(new URL("../.engines", import.meta.url))

async function available(engine) {
    try {
        const ex = await createExecutor(engine, { root: ENGINES_ROOT, path: ":memory:" })
        await ex.close?.()
        return true
    } catch {
        return false
    }
}

const TASK = schema({
    name: "task",
    fields: [
        field("title", "text", { required: true }),
        field("done", "boolean", { default: false }),
        field("priority", "select", { options: ["low", "medium", "high"] }),
        field("points", "integer")
    ]
})
const policy = { entity: "task", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false }
const CTX = { user: "u1", roles: [], policies: [policy], shares: [] }

// Schema matching the AST-Q random generator's field space, for LIVE-03.
const FIXT = schema({
    name: "fixt",
    fields: [
        field("tier", "text"),
        field("age", "integer"),
        field("active", "boolean"),
        field("name", "text"),
        field("score", "integer")
    ]
})

/** Register the live suite for an engine, or one skip note when absent. */
function liveSuite(engine, isAvailable) {
    if (!isAvailable) {
        Test.describe(`Live engine — ${engine} (LIVE, driver absent)`, () => {
            Test.it(`LIVE-${engine}-00 skipped — install the driver under test/.engines to run`, () => {}, { browser: true })
        })
        return
    }

    Test.describe(`Live engine — ${engine} (LIVE)`, () => {
        Test.it(`LIVE-${engine}-01 DDL builds the entity table on the real engine`, async () => {
            const ex = await createExecutor(engine, { root: ENGINES_ROOT, path: ":memory:" })
            const kysely = createCompiler(ex.dialect)
            for (const b of tableDDL(kysely, TASK, { dialect: ex.dialect })) await ex.run(b.compile().sql)
            const cols = (await ex.all("PRAGMA table_info(task)")).map((c) => c.name)
            for (const c of ["id", "owner", "title", "done", "priority", "points"]) assert.truthy(cols.includes(c), c)
            await ex.close?.()
        })

        Test.it(`LIVE-${engine}-02 full Data Plane CRUD cycle runs on the real engine`, async () => {
            const ex = await createExecutor(engine, { root: ENGINES_ROOT, path: ":memory:" })
            const kysely = createCompiler(ex.dialect)
            for (const b of tableDDL(kysely, TASK, { dialect: ex.dialect })) await ex.run(b.compile().sql)
            const plane = new DataPlane({ executor: ex, schemas: [TASK], dialect: ex.dialect })
            const created = await plane.create("task", { title: "on turso", priority: "high" }, CTX)
            assert.equal(created.done, false)
            assert.equal((await plane.get("task", created.id, CTX)).title, "on turso")
            await plane.update("task", created.id, { done: true }, CTX)
            assert.equal((await plane.get("task", created.id, CTX)).done, true)
            const listed = await plane.list("task", {}, CTX)
            assert.equal(listed.length, 1)
            await plane.remove("task", created.id, CTX)
            assert.deepEqual(await plane.list("task", {}, CTX), [])
            await ex.close?.()
        })

        Test.it(`LIVE-${engine}-03 GOLDEN INVARIANT on the real engine: compiled SQL ≡ reference predicate`, async () => {
            const ex = await createExecutor(engine, { root: ENGINES_ROOT, path: ":memory:" })
            const kysely = createCompiler(ex.dialect)
            for (const b of tableDDL(kysely, FIXT, { dialect: ex.dialect })) await ex.run(b.compile().sql)

            const rnd = prng(0x7020)
            const rows = []
            for (let i = 0; i < 40; i++) {
                const r = { id: `R${i}`, ...randomRow(rnd) }
                rows.push(r)
                const cols = ["id", "tier", "age", "active", "name", "score"]
                const bind = cols.map((c) => (r[c] === true ? 1 : r[c] === false ? 0 : r[c] ?? null))
                await ex.run(`INSERT INTO fixt (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`, bind)
            }
            for (let i = 0; i < 80; i++) {
                const document = doc(randomNode(rnd))
                const compiled = applyWhere(kysely.selectFrom("fixt").select("id"), document, { dialect: ex.dialect }).compile()
                const sqlIds = (await ex.all(compiled.sql, [...compiled.parameters].map((v) => (v === true ? 1 : v === false ? 0 : v)))).map((r) => r.id).sort()
                const jsIds = rows.filter(AST.predicate(document)).map((r) => r.id).sort()
                assert.deepEqual(sqlIds, jsIds, `diverged on ${JSON.stringify(document.root)}`)
            }
            await ex.close?.()
        })

        Test.it(`LIVE-${engine}-04 Migration Engine hot-applies on the real engine`, async () => {
            const ex = await createExecutor(engine, { root: ENGINES_ROOT, path: ":memory:" })
            const kysely = createCompiler(ex.dialect)
            for (const b of tableDDL(kysely, TASK, { dialect: ex.dialect })) await ex.run(b.compile().sql)
            const plane = new DataPlane({ executor: ex, schemas: [TASK], dialect: ex.dialect })
            await plane.create("task", { title: "before" }, CTX)
            const next = schema({ name: "task", fields: [...TASK.fields, field("nick", "text")] })
            const p = plan(kysely, TASK, next, { dialect: ex.dialect })
            assert.equal(p.isHot, true)
            await hotApply(ex, kysely, TASK, next, { dialect: ex.dialect })
            const cols = (await ex.all("PRAGMA table_info(task)")).map((c) => c.name)
            assert.truthy(cols.includes("nick"))
            assert.equal((await ex.all("SELECT title FROM task"))[0].title, "before")
            await ex.close?.()
        })
    })
}

liveSuite("turso", await available("turso"))
