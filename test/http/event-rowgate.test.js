/**
 * The remove event stops leaking ids past the row rule (EVT-ROWGATE-*) —
 * issue #9 I11.
 *
 * `remove()` read only ["id"] for its pre-image, so by the time `after:remove`
 * fired, nothing about the row survived. The hub therefore fell back to a
 * DOCUMENT-level check: `Permission.resolve(...).allowed`, which is true
 * whenever ANY permlevel-0 read policy applies — the row-restricting
 * `rule`/`ifOwner` survive only in the `filter`, which that check discards.
 *
 * The consequence, stated at its real width: any subscriber with
 * document-level read on an entity learned the id of EVERY removed row of that
 * entity, regardless of row-level restrictions. In a multi-tenant instance
 * that is a cross-tenant identifier feed, not a footnote.
 *
 * The fix captures the pre-image in `remove()` and gates on it. EVT-ROWGATE-03
 * exists because a fix that closed an id leak by putting the row on the wire
 * would be a worse bug than the one it closed.
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import { DataPlane } from "../../src/core/Data.js"
import { Extensions } from "../../src/core/App/extensions.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { handleTransaction } from "../../src/core/Data/transaction.js"

const TASK = {
    schemaVersion: 1,
    name: "task",
    label: { en: "Task" },
    fields: [{ name: "title", type: "text", label: { en: "T" } }]
}

/** A subscriber whose read grant is restricted to the rows it OWNS. */
const owner = (user) => ({
    user,
    roles: [],
    shares: [],
    policies: [{ entity: "task", actions: ["read", "create", "write", "delete"], rule: null, permlevel: 0, ifOwner: true }]
})

function makePlane() {
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const builder of tableDDL(kysely, TASK)) db.exec(builder.compile().sql)
    const run = (sql, params = []) => void db.prepare(sql).run(...params)
    const all = (sql, params = []) => db.prepare(sql).all(...params)
    const hooks = new Extensions()
    const plane = new DataPlane({
        executor: { run, all, transaction: handleTransaction(run, all, "BEGIN IMMEDIATE") },
        schemas: [TASK],
        dialect: "sqlite",
        hooks,
        now: () => "2026-07-21T00:00:00.000Z"
    })
    return { plane, hooks }
}

/** A fake SSE response that records the frames written to it. */
const recorder = () => {
    const frames = []
    return { frames, writeHead() {}, write(chunk) { frames.push(chunk) }, end() {}, on() {} }
}

const dataFrames = (res) => res.frames.filter((f) => f.startsWith("data:")).map((f) => JSON.parse(f.slice(5)))

Test.describe("Remove events respect the row rule (EVT-ROWGATE)", () => {

    Test.it("EVT-ROWGATE-01 a subscriber whose row rule EXCLUDES the removed row does not learn its id", async () => {
        const { createEventHub } = await import("../../src/core/HTTP/events.js")
        const { plane, hooks } = makePlane()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        hub.attach(hooks, [TASK])

        const mine = await plane.create("task", { title: "u1's" }, owner("u1"))

        // u2 holds a perfectly good permlevel-0 read policy on `task` — the
        // document-level check says yes. Only the row rule says no.
        const res = recorder()
        hub.subscribe({ res, ctx: owner("u2"), entities: ["task"] })

        await plane.remove("task", mine.id, owner("u1"))

        assert.deepEqual(dataFrames(res), [], "a row u2 could never have read must not surface on deletion")
        hub.stop()
    })

    Test.it("EVT-ROWGATE-02 a subscriber the row rule DOES match still receives it — the fix narrows, it does not blind", async () => {
        const { createEventHub } = await import("../../src/core/HTTP/events.js")
        const { plane, hooks } = makePlane()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        hub.attach(hooks, [TASK])

        const mine = await plane.create("task", { title: "u1's" }, owner("u1"))
        const res = recorder()
        hub.subscribe({ res, ctx: owner("u1"), entities: ["task"] })

        await plane.remove("task", mine.id, owner("u1"))

        const frames = dataFrames(res)
        assert.equal(frames.length, 1, "the owner must still be told its own row went away")
        assert.equal(frames[0].event, "remove")
        assert.equal(frames[0].id, mine.id)
        hub.stop()
    })

    Test.it("EVT-ROWGATE-03 the captured row decides visibility and NEVER reaches the wire", async () => {
        const { createEventHub } = await import("../../src/core/HTTP/events.js")
        const { plane, hooks } = makePlane()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        hub.attach(hooks, [TASK])

        const mine = await plane.create("task", { title: "a-very-distinctive-secret" }, owner("u1"))
        const res = recorder()
        hub.subscribe({ res, ctx: owner("u1"), entities: ["task"] })

        await plane.remove("task", mine.id, owner("u1"))

        const [frame] = dataFrames(res)
        assert.deepEqual(Object.keys(frame).sort(), ["entity", "event", "id", "ts"])
        assert.falsy(res.frames.join("").includes("a-very-distinctive-secret"), "no field of the captured row may ride the stream")
        hub.stop()
    })

    Test.it("EVT-ROWGATE-04 a remove event with NO captured row denies, rather than falling back to the old permissive answer", async () => {
        const { createEventHub } = await import("../../src/core/HTTP/events.js")
        const { plane } = makePlane()
        const hub = createEventHub({ plane, heartbeatMs: 0 })

        const res = recorder()
        hub.subscribe({ res, ctx: owner("u1"), entities: ["task"] })

        // Emitted by hand, the way a hook that never captured a row would:
        // there is nothing to evaluate the rule against, so the answer is no.
        await hub.emit({ entity: "task", event: "remove", id: "01ABCDEF" })

        assert.deepEqual(dataFrames(res), [], "unable to prove visibility is not permission to send")
        hub.stop()
    })

    Test.it("EVT-ROWGATE-05 after:remove carries the row for hooks that need it, additively — payload.id still means what it meant", async () => {
        const { plane, hooks } = makePlane()
        const seen = []
        hooks.hook("task", "after:remove", (payload) => seen.push(payload))
        hooks.hook("task", "before:remove", (payload) => seen.push(payload))

        const mine = await plane.create("task", { title: "t" }, owner("u1"))
        await plane.remove("task", mine.id, owner("u1"))

        assert.equal(seen.length, 2)
        for (const payload of seen) {
            assert.equal(payload.id, mine.id, "the pre-existing field must not have moved")
            assert.equal(payload.row.title, "t", "and the row is there for hooks that want it")
        }
    })
})
