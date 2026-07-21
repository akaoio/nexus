/**
 * Writes atomic with derived state, after-hooks contained (DPL-ATOMIC-*) —
 * issue #9 I7.
 *
 * The write path ran INSERT → embedding → after-hook, each awaited in sequence
 * with no envelope, and two distinct failures hid in that:
 *
 *  (a) `#maintainEmbedding` throws AFTER the row committed. The caller gets a
 *      500, the row is there, the embedding is not — so the client believes
 *      the write failed and retries, producing a second row.
 *  (b) An after-hook throws and the write is reported as failed, though it is
 *      durably committed. Same duplicate-write retry, from the other end.
 *
 * The boundary this suite pins: INSIDE the transaction, the row and everything
 * derived from it. OUTSIDE and after commit, everything that reaches the world.
 * `before:` hooks keep their veto — running before anything is written is the
 * correct place for it — and an after-hook failure is CONTAINED, not swallowed:
 * it goes to onHookError, loud in the operator's log and invisible to a caller
 * who must not retry.
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import { DataPlane } from "../../src/core/Data.js"
import { Extensions } from "../../src/core/App/extensions.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { handleTransaction } from "../../src/core/Data/transaction.js"
import { schema, field } from "../conformance/model/_helpers.js"

const NOTE = schema({
    name: "note",
    fields: [field("title", "text", { required: true }), field("body", "text")],
    semantic: { embed: [{ field: "title" }, { field: "body" }], reindex: "on_update" }
})

const policy = { entity: "note", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false }
const CTX = { user: "u1", roles: [], policies: [policy], shares: [] }

/** An embedder that works until told to fail. */
const embedder = (state) => ({
    name: "test-embedder",
    version: 1,
    embed: async (texts) => {
        if (state.fail) throw new Error("E_EMBED: the model could not be loaded")
        return texts.map(() => [0.1, 0.2, 0.3])
    }
})

function makePlane({ hooks = null, onHookError, embedderState = { fail: false } } = {}) {
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const builder of tableDDL(kysely, NOTE)) db.exec(builder.compile().sql)
    const run = (sql, params = []) => void db.prepare(sql).run(...params)
    const all = (sql, params = []) => db.prepare(sql).all(...params)
    const executor = { run, all, transaction: handleTransaction(run, all, "BEGIN IMMEDIATE") }
    const plane = new DataPlane({
        executor,
        schemas: [NOTE],
        dialect: "sqlite",
        now: () => "2026-07-21T00:00:00.000Z",
        hooks,
        embedder: embedder(embedderState),
        onHookError
    })
    return { plane, db, embedderState }
}

const rowCount = (db) => db.prepare(`SELECT COUNT(*) AS n FROM note`).all()[0].n

Test.describe("Atomic writes and contained after-hooks (DPL-ATOMIC)", () => {

    Test.it("DPL-ATOMIC-01 an embedder that fails leaves NO row behind — the caller's error is true, so a retry is correct", async () => {
        const state = { fail: true }
        const { plane, db } = makePlane({ embedderState: state })

        await assert.rejects(plane.create("note", { title: "hello", body: "world" }, CTX), "E_EMBED")
        assert.equal(rowCount(db), 0, "a row whose derived state could not be built must not be left committed")
    })

    Test.it("DPL-ATOMIC-01b the same on update — a failed re-embed leaves the PRE-IMAGE intact, not a half-updated row", async () => {
        const state = { fail: false }
        const { plane, db } = makePlane({ embedderState: state })
        const created = await plane.create("note", { title: "before", body: "b" }, CTX)

        state.fail = true
        await assert.rejects(plane.update("note", created.id, { title: "after" }, CTX), "E_EMBED")

        assert.equal(db.prepare(`SELECT title FROM note WHERE id = ?`).all(created.id)[0].title, "before", "the patch must have rolled back with its embedding")
    })

    Test.it("DPL-ATOMIC-02 a throwing after-hook does NOT fail the write, and the row is durable", async () => {
        const hooks = new Extensions()
        hooks.hook("note", "after:create", () => { throw new Error("E_HOOK: the app's own failure") })
        hooks.hook("note", "after:update", () => { throw new Error("E_HOOK: the app's own failure") })
        hooks.hook("note", "after:remove", () => { throw new Error("E_HOOK: the app's own failure") })
        const { plane, db } = makePlane({ hooks, onHookError: () => {} })

        const created = await plane.create("note", { title: "kept" }, CTX)
        assert.equal(rowCount(db), 1, "the write is committed — telling the caller otherwise invites a duplicate retry")

        const patched = await plane.update("note", created.id, { title: "patched" }, CTX)
        assert.equal(patched.title, "patched")

        assert.equal(await plane.remove("note", created.id, CTX), true)
        assert.equal(rowCount(db), 0)
    })

    Test.it("DPL-ATOMIC-03 that failure is CONTAINED, not swallowed — it reaches onHookError naming the entity and the event", async () => {
        const seen = []
        const hooks = new Extensions()
        hooks.hook("note", "after:create", () => { throw new Error("E_HOOK: boom") })
        const { plane } = makePlane({ hooks, onHookError: (report) => seen.push(report) })

        await plane.create("note", { title: "x" }, CTX)

        assert.equal(seen.length, 1, "an operator must be able to see it")
        assert.equal(seen[0].entity, "note")
        assert.equal(seen[0].event, "after:create")
        assert.truthy(seen[0].error.message.includes("E_HOOK"))
    })

    Test.it("DPL-ATOMIC-04 a throwing BEFORE hook still vetoes, and leaves no row — the veto contract is unchanged", async () => {
        const hooks = new Extensions()
        hooks.hook("note", "before:create", () => { throw new Error("E_VETO: not allowed") })
        const { plane, db } = makePlane({ hooks, onHookError: () => {} })

        await assert.rejects(plane.create("note", { title: "x" }, CTX), "E_VETO")
        assert.equal(rowCount(db), 0, "a veto must reach the caller AND write nothing")
    })

    Test.it("DPL-ATOMIC-05 the embedding is derived BEFORE the write opens — model inference never holds a write lock", async () => {
        // Ordering is observable: the embedder is called before any INSERT
        // reaches the engine. This is what keeps a slow model from blocking
        // every other writer for the length of an inference.
        const order = []
        const db = new DatabaseSync(":memory:")
        const kysely = createCompiler("sqlite")
        for (const builder of tableDDL(kysely, NOTE)) db.exec(builder.compile().sql)
        const run = (sql, params = []) => {
            if (/^insert into "?note/i.test(sql.trim())) order.push("insert")
            return void db.prepare(sql).run(...params)
        }
        const all = (sql, params = []) => db.prepare(sql).all(...params)
        const plane = new DataPlane({
            executor: { run, all, transaction: handleTransaction(run, all, "BEGIN IMMEDIATE") },
            schemas: [NOTE],
            dialect: "sqlite",
            now: () => "2026-07-21T00:00:00.000Z",
            embedder: { name: "ordered", version: 1, embed: async (t) => { order.push("embed"); return t.map(() => [1, 0, 0]) } }
        })

        await plane.create("note", { title: "x" }, CTX)
        assert.deepEqual(order, ["embed", "insert"])
    })
})
