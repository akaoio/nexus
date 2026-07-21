/**
 * SSE fan-out cost and subscriber cap (EVT-FANOUT-*, EVT-CAP-*) — issue #9's
 * "fan-out is unbounded by subscriber count" moderate.
 *
 * `emit()` awaited `visible()` per subscriber in sequence, and for a
 * create/update each `visible()` is a full `plane.get`. A thousand
 * idle-but-connected subscribers made every single write cost a thousand
 * serial queries.
 *
 * Parallelising is the wrong first move: it turns a thousand serial queries
 * into a thousand concurrent ones, which is harder on the engine, not easier.
 * The real shape of the waste is that a thousand subscribers do not have a
 * thousand authorization contexts — `visible()` is a pure function of
 * (entity, id, event, authorization inputs), so the answer is memoised for the
 * duration of ONE emit and discarded.
 *
 * EVT-FANOUT-02 is the clause that keeps that safe. The fingerprint must
 * include the USER, because `$CURRENT_USER` and `ifOwner` make the same policy
 * set mean different things for different people — a memo keyed on policies
 * alone would show one tenant another's row.
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { handleTransaction } from "../../src/core/Data/transaction.js"
import { createEventHub } from "../../src/core/HTTP/events.js"

const TASK = {
    schemaVersion: 1,
    name: "task",
    label: { en: "Task" },
    fields: [{ name: "title", type: "text", label: { en: "T" } }]
}

/** Read policy restricted to rows the caller owns. */
const ownerPolicies = [{ entity: "task", actions: ["read", "create", "write", "delete"], rule: null, permlevel: 0, ifOwner: true }]
const ctxFor = (user) => ({ user, roles: [], shares: [], policies: ownerPolicies })

/** A plane that counts how many visibility reads the hub actually performs. */
function makeCountingPlane() {
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const b of tableDDL(kysely, TASK)) db.exec(b.compile().sql)
    const run = (sql, params = []) => void db.prepare(sql).run(...params)
    const all = (sql, params = []) => db.prepare(sql).all(...params)
    const plane = new DataPlane({
        executor: { run, all, transaction: handleTransaction(run, all, "BEGIN IMMEDIATE") },
        schemas: [TASK],
        dialect: "sqlite",
        now: () => "2026-07-21T00:00:00.000Z"
    })
    const counter = { gets: 0 }
    const realGet = plane.get.bind(plane)
    plane.get = (...args) => { counter.gets++; return realGet(...args) }
    return { plane, counter }
}

const recorder = () => {
    const frames = []
    return { frames, writeHead() {}, write(chunk) { frames.push(chunk) }, end() {}, on() {} }
}
const dataFrames = (res) => res.frames.filter((f) => f.startsWith("data:")).map((f) => JSON.parse(f.slice(5)))

Test.describe("SSE fan-out cost and caps (EVT-FANOUT / EVT-CAP)", () => {

    Test.it("EVT-FANOUT-01 many subscribers sharing ONE authorization context cost ONE visibility read, not one each", async () => {
        const { plane, counter } = makeCountingPlane()
        const hub = createEventHub({ plane, heartbeatMs: 0, maxSubscribers: 200 })
        const row = await plane.create("task", { title: "t" }, ctxFor("u1"))

        const responses = []
        for (let i = 0; i < 50; i++) {
            const res = recorder()
            responses.push(res)
            hub.subscribe({ res, ctx: ctxFor("u1"), entities: ["task"] })
        }

        counter.gets = 0
        await hub.emit({ entity: "task", event: "update", id: row.id })

        assert.equal(counter.gets, 1, `50 subscribers with one context must cost one read, saw ${counter.gets}`)
        for (const res of responses) assert.equal(dataFrames(res).length, 1, "and every one of them is still told")
        hub.stop()
    })

    Test.it("EVT-FANOUT-02 identical policies with DIFFERENT users are never deduped together — ifOwner makes them mean different things", async () => {
        const { plane, counter } = makeCountingPlane()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        const mine = await plane.create("task", { title: "u1's" }, ctxFor("u1"))

        const a = recorder(), b = recorder()
        hub.subscribe({ res: a, ctx: ctxFor("u1"), entities: ["task"] }) // same policies…
        hub.subscribe({ res: b, ctx: ctxFor("u2"), entities: ["task"] }) // …different user

        counter.gets = 0
        await hub.emit({ entity: "task", event: "update", id: mine.id })

        assert.equal(counter.gets, 2, "two distinct users must be asked separately")
        assert.equal(dataFrames(a).length, 1, "the owner is told")
        assert.equal(dataFrames(b).length, 0, "the other user is NOT — a memo keyed on policies alone would have leaked this")
        hub.stop()
    })

    Test.it("EVT-FANOUT-03 the memo lasts one emit — a visibility change between emits is seen", async () => {
        const { plane } = makeCountingPlane()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        const row = await plane.create("task", { title: "t" }, ctxFor("u1"))

        const res = recorder()
        hub.subscribe({ res, ctx: ctxFor("u1"), entities: ["task"] })

        await hub.emit({ entity: "task", event: "update", id: row.id })
        assert.equal(dataFrames(res).length, 1)

        await plane.remove("task", row.id, ctxFor("u1")) // the row is gone now
        await hub.emit({ entity: "task", event: "update", id: row.id })

        assert.equal(dataFrames(res).length, 1, "the second emit must re-ask, not replay a cached yes")
        hub.stop()
    })

    Test.it("EVT-CAP-01 subscribing past the cap is refused, and the subscribers already connected are unaffected", async () => {
        const { plane } = makeCountingPlane()
        const hub = createEventHub({ plane, heartbeatMs: 0, maxSubscribers: 2 })
        const row = await plane.create("task", { title: "t" }, ctxFor("u1"))

        const a = recorder(), b = recorder(), c = recorder()
        assert.truthy(hub.subscribe({ res: a, ctx: ctxFor("u1"), entities: ["task"] }))
        assert.truthy(hub.subscribe({ res: b, ctx: ctxFor("u1"), entities: ["task"] }))
        assert.equal(hub.subscribe({ res: c, ctx: ctxFor("u1"), entities: ["task"] }), null, "past the cap, refused")
        assert.equal(hub.size(), 2)

        await hub.emit({ entity: "task", event: "update", id: row.id })
        assert.equal(dataFrames(a).length, 1, "an existing subscriber must not be disturbed by someone else being refused")
        assert.equal(dataFrames(b).length, 1)
        assert.equal(dataFrames(c).length, 0)
        hub.stop()
    })
})
