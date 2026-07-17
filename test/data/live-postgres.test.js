/**
 * Live Postgres conformance (LIVEPG-*) — the data plane on REAL Postgres,
 * proven on this very machine. PGlite (@electric-sql/pglite) is Postgres
 * compiled to WASM, in-process, no server — the same trick Turso pulls for
 * sqlite. The `pg` driver runs the identical clauses against a real cluster
 * in the CI matrix; the SQL, placeholders ($1), and executor contract are the
 * same, so proving it here proves the postgres dialect end to end.
 *
 * The driver is the instance's dependency (N2), resolved from test/.engines/;
 * absent → the clauses skip, suite stays green:
 *
 *   npm --prefix test/.engines install @electric-sql/pglite
 */

import { fileURLToPath } from "url"
import Test, { assert } from "../../src/core/Test.js"
import { createExecutor } from "../../src/core/Data/adapters.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { applyWhere } from "../../src/core/Data/compile.js"
import { plan, hotApply } from "../../src/core/Data/migrate.js"
import * as AST from "../../src/core/AST.js"
import { schema, field } from "../conformance/model/_helpers.js"
import { doc, prng, randomNode, randomRow } from "../conformance/ast/_helpers.js"

const ENGINES_ROOT = fileURLToPath(new URL("../.engines", import.meta.url))
const cfg = { root: ENGINES_ROOT, pglite: true }

async function available() {
    try {
        const ex = await createExecutor("postgres", cfg)
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
const FIXT = schema({
    name: "fixt",
    fields: [field("tier", "text"), field("age", "integer"), field("active", "boolean"), field("name", "text"), field("score", "integer")]
})
const policy = { entity: "task", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false }
const CTX = { user: "u1", roles: [], policies: [policy], shares: [] }

const cols = (ex, table) => ex.all(`SELECT column_name FROM information_schema.columns WHERE table_name = $1`, [table])

const ok = await available()
if (!ok) {
    Test.describe("Live Postgres — PGlite (LIVEPG, driver absent)", () => {
        Test.it("LIVEPG-00 skipped — npm --prefix test/.engines install @electric-sql/pglite to run", () => {}, { browser: true })
    })
} else {
    Test.describe("Live Postgres — PGlite (LIVEPG)", () => {
        Test.it("LIVEPG-01 DDL builds the entity table on real Postgres", async () => {
            const ex = await createExecutor("postgres", cfg)
            const kysely = createCompiler(ex.dialect)
            for (const b of tableDDL(kysely, TASK, { dialect: ex.dialect })) await ex.run(b.compile().sql)
            const names = (await cols(ex, "task")).map((c) => c.column_name)
            for (const c of ["id", "owner", "title", "done", "priority", "points"]) assert.truthy(names.includes(c), c)
            await ex.close?.()
        })

        Test.it("LIVEPG-02 full Data Plane CRUD cycle runs on real Postgres", async () => {
            const ex = await createExecutor("postgres", cfg)
            const kysely = createCompiler(ex.dialect)
            for (const b of tableDDL(kysely, TASK, { dialect: ex.dialect })) await ex.run(b.compile().sql)
            const plane = new DataPlane({ executor: ex, schemas: [TASK], dialect: ex.dialect })
            const created = await plane.create("task", { title: "on pg", priority: "high" }, CTX)
            assert.equal(created.done, false)
            assert.equal((await plane.get("task", created.id, CTX)).title, "on pg")
            await plane.update("task", created.id, { done: true }, CTX)
            assert.equal((await plane.get("task", created.id, CTX)).done, true)
            assert.equal((await plane.list("task", {}, CTX)).length, 1)
            await plane.remove("task", created.id, CTX)
            assert.deepEqual(await plane.list("task", {}, CTX), [])
            await ex.close?.()
        })

        Test.it("LIVEPG-03 GOLDEN INVARIANT on real Postgres: compiled SQL ≡ reference predicate", async () => {
            const ex = await createExecutor("postgres", cfg)
            const kysely = createCompiler(ex.dialect)
            for (const b of tableDDL(kysely, FIXT, { dialect: ex.dialect })) await ex.run(b.compile().sql)

            const rnd = prng(0x70c)
            const rows = []
            for (let i = 0; i < 40; i++) {
                const r = { id: `R${i}`, ...randomRow(rnd) }
                rows.push(r)
                // Insert via Kysely so the postgres dialect renders $N placeholders
                // and real boolean/int types — no sqlite-style 1/0 coercion.
                const compiled = kysely.insertInto("fixt").values(r).compile()
                await ex.run(compiled.sql, [...compiled.parameters])
            }
            for (let i = 0; i < 80; i++) {
                const document = doc(randomNode(rnd))
                const compiled = applyWhere(kysely.selectFrom("fixt").select("id"), document, { dialect: ex.dialect }).compile()
                const sqlIds = (await ex.all(compiled.sql, [...compiled.parameters])).map((r) => r.id).sort()
                const jsIds = rows.filter(AST.predicate(document)).map((r) => r.id).sort()
                assert.deepEqual(sqlIds, jsIds, `diverged on ${JSON.stringify(document.root)}`)
            }
            await ex.close?.()
        })

        Test.it("LIVEPG-04 Migration Engine hot-applies on real Postgres", async () => {
            const ex = await createExecutor("postgres", cfg)
            const kysely = createCompiler(ex.dialect)
            for (const b of tableDDL(kysely, TASK, { dialect: ex.dialect })) await ex.run(b.compile().sql)
            const plane = new DataPlane({ executor: ex, schemas: [TASK], dialect: ex.dialect })
            await plane.create("task", { title: "before" }, CTX)
            const next = schema({ name: "task", fields: [...TASK.fields, field("nick", "text")] })
            const p = plan(kysely, TASK, next, { dialect: ex.dialect })
            assert.equal(p.isHot, true)
            await hotApply(ex, kysely, TASK, next, { dialect: ex.dialect })
            assert.truthy((await cols(ex, "task")).map((c) => c.column_name).includes("nick"))
            assert.equal((await ex.all(`SELECT title FROM task`))[0].title, "before")
            await ex.close?.()
        })
    })
}
