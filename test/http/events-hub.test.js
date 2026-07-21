/**
 * Realtime event hub (EVT-*) — SSE subscribers fed by after-hooks,
 * permission never leaves the plane: a subscriber sees an event only if
 * they can re-read the row through the Data Plane under their own context.
 * Failures are contained twice over: a hook failure never fails the write,
 * and one broken subscriber never starves the rest.
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { SYSTEM_ENTITIES } from "../../src/core/App/system.js"
import { Extensions } from "../../src/core/App/extensions.js"
import { createEventHub } from "../../src/core/HTTP/events.js"

let clock = 1_000_000
const now = () => clock

// Task schema — a non-system entity for testing
const TASK_SCHEMA = {
    schemaVersion: 1,
    name: "task",
    label: { en: "Task" },
    fields: [
        { name: "title", type: "text", label: { en: "T" } }
    ]
}

const allSchemas = [...SYSTEM_ENTITIES, TASK_SCHEMA]

// Contexts for testing
const ADMIN = {
    user: "admin",
    roles: [],
    shares: [],
    policies: [
        { entity: "task", actions: ["read", "create", "write", "delete"], rule: null, permlevel: 0, ifOwner: false },
        { entity: "nexus_job", actions: ["read", "create", "write", "delete"], rule: null, permlevel: 0, ifOwner: false }
    ]
}

const VIEWER = {
    user: "viewer",
    roles: [],
    shares: [],
    policies: [
        { entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }
    ]
}

const NOBODY = {
    user: "nobody",
    roles: [],
    shares: [],
    policies: []
}

function fakeRes() {
    const chunks = []
    const listeners = {}
    return {
        chunks,
        writeHead() {},
        write(s) { chunks.push(String(s)); return true },
        end() { this.ended = true },
        on(ev, fn) { listeners[ev] = fn },
        _close() { listeners.close?.() }
    }
}

function events(res) {
    return res.chunks
        .filter((c) => c.startsWith("data:"))
        .map((c) => JSON.parse(c.slice(5)))
}

function makePlane() {
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const schema of allSchemas) {
        for (const builder of tableDDL(kysely, schema)) {
            db.exec(builder.compile().sql)
        }
    }
    const executor = {
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: (sql, params = []) => db.prepare(sql).all(...params)
    }
    return new DataPlane({ executor, schemas: allSchemas, dialect: "sqlite", now })
}

Test.describe("Realtime event hub (EVT-*)", () => {
    const setup = () => { clock = 1_000_000; return makePlane() }

    Test.it("EVT-U1 permission never leaves the plane: create/update events reach only subscribers who can re-read the row", async () => {
        const plane = setup()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        const a = fakeRes(), v = fakeRes(), n = fakeRes()
        hub.subscribe({ res: a, ctx: ADMIN, entities: null })
        hub.subscribe({ res: v, ctx: VIEWER, entities: null })
        hub.subscribe({ res: n, ctx: NOBODY, entities: null })
        const row = await plane.create("task", { title: "t1" }, ADMIN)
        await hub.emit({ entity: "task", event: "create", id: row.id })
        assert.equal(events(a).length, 1)
        assert.equal(events(v).length, 1) // viewer may read task
        assert.equal(events(n).length, 0) // deny-by-default: no event, no id leak
        const e = events(v)[0]
        assert.deepEqual(Object.keys(e).sort(), ["entity", "event", "id", "ts"]) // no row data on the wire
        assert.equal(e.entity, "task")
        assert.equal(e.event, "create")
        assert.equal(e.id, row.id)
        hub.stop()
    })

    // CHANGED by issue #9 I11. This clause used to read "remove events use the
    // doc-level check (the row is gone)" and emitted with NO row — which is
    // precisely what pinned the leak in place: a document-level yes was
    // enough, so every deleted id crossed every row-level rule. What the
    // clause was actually there to protect — a subscriber with read on the
    // entity is told, one without is not — is unchanged and still asserted
    // below. The row rule is now applied as well, against the pre-image the
    // plane captures; EVT-ROWGATE-* pins that half, including that a missing
    // pre-image now denies rather than allows.
    Test.it("EVT-U2 remove events still respect the document-level grant — told if you may read the entity, silent if you may not", async () => {
        const plane = setup()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        const v = fakeRes(), n = fakeRes()
        hub.subscribe({ res: v, ctx: VIEWER, entities: null })
        hub.subscribe({ res: n, ctx: NOBODY, entities: null })
        await hub.emit({ entity: "task", event: "remove", id: "gone-id", row: { id: "gone-id", title: "t", owner: "someone" } })
        assert.equal(events(v).length, 1)
        assert.equal(events(n).length, 0)
        hub.stop()
    })

    Test.it("EVT-U3 nexus_job is opt-in: excluded by default, delivered when named in entities", async () => {
        const plane = setup()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        const def = fakeRes(), opt = fakeRes()
        hub.subscribe({ res: def, ctx: ADMIN, entities: null })
        hub.subscribe({ res: opt, ctx: ADMIN, entities: ["nexus_job"] })
        const job = await plane.create("nexus_job", {
            name: "x.y",
            payload: "{}",
            status: "pending",
            run_at: new Date().toISOString(),
            attempts: 0,
            max_attempts: 5
        }, ADMIN)
        await hub.emit({ entity: "nexus_job", event: "create", id: job.id })
        assert.equal(events(def).length, 0)
        assert.equal(events(opt).length, 1)
        hub.stop()
    })

    Test.it("EVT-U4 a broken subscriber is reaped; the others still receive; close() reaps too", async () => {
        const plane = setup()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        const good = fakeRes()
        const bad = fakeRes()
        bad.write = () => { throw new Error("EPIPE") }
        hub.subscribe({ res: bad, ctx: ADMIN, entities: null })
        hub.subscribe({ res: good, ctx: ADMIN, entities: null })
        const row = await plane.create("task", { title: "t2" }, ADMIN)
        await hub.emit({ entity: "task", event: "create", id: row.id })
        assert.equal(events(good).length, 1) // one bad pipe never starves the rest
        assert.equal(hub.size(), 1) // bad reaped
        good._close()
        assert.equal(hub.size(), 0)
        hub.stop()
    })

    Test.it("EVT-U6 heartbeat: an idle subscriber receives :hb frames on the injected interval", async () => {
        const plane = setup()
        const hub = createEventHub({ plane, heartbeatMs: 30 })
        const idle = fakeRes()
        hub.subscribe({ res: idle, ctx: ADMIN, entities: null })
        await new Promise((r) => setTimeout(r, 120))
        assert.truthy(idle.chunks.some((c) => c.startsWith(":hb")))
        hub.stop()
        const after = idle.chunks.length
        await new Promise((r) => setTimeout(r, 80))
        assert.equal(idle.chunks.length, after) // stop() means silence
    })

    Test.it("EVT-U5 attach(): a plane write fires the hub through the hooks, and a hub failure never fails the write", async () => {
        const plane = setup()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        const ext = new Extensions()
        hub.attach(ext, allSchemas)
        const hooked = new DataPlane({ executor: plane.executor, schemas: allSchemas, hooks: ext, now, dialect: "sqlite" })
        const sub = fakeRes()
        hub.subscribe({ res: sub, ctx: ADMIN, entities: null })
        const row = await hooked.create("task", { title: "hooked" }, ADMIN)
        await new Promise((r) => setTimeout(r, 20)) // hook emit is fire-and-forget
        assert.equal(events(sub).length, 1)
        hub.emit = () => { throw new Error("hub exploded") } // sabotage
        const second = await hooked.create("task", { title: "still lands" }, ADMIN) // must not throw
        assert.truthy(second.id)
        hub.stop()
    })

    Test.it("EVT-U7 a $NOW-ruled policy never reaps the subscriber: the event is gated, the connection survives", async () => {
        const plane = setup()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        const timed = fakeRes()
        const TIMED_CTX = { user: "t", roles: [], shares: [], policies: [
            { entity: "task", actions: ["read"], rule: { astVersion: 1, root: { field: "created_at", operator: "lte", value: "$NOW" } }, permlevel: 0, ifOwner: false }
        ] }
        hub.subscribe({ res: timed, ctx: TIMED_CTX, entities: null })
        await hub.emit({ entity: "task", event: "remove", id: "whatever" })
        assert.equal(hub.size(), 1) // NOT reaped — this is the point
        hub.stop()
    })

    Test.it("EVT-U8 the write NEVER waits for the fan-out: a hung emit does not block create", async () => {
        const plane = setup()
        const hub = createEventHub({ plane, heartbeatMs: 0 })
        const ext = new Extensions()
        hub.attach(ext, allSchemas)
        hub.emit = () => new Promise(() => {}) // a fan-out that never finishes
        const hooked = new DataPlane({ executor: plane.executor, schemas: allSchemas, hooks: ext, now, dialect: "sqlite" })
        const t0 = Date.now()
        const row = await hooked.create("task", { title: "instant" }, ADMIN)
        assert.truthy(row.id)
        assert.truthy(Date.now() - t0 < 2000) // returns immediately, not after the fan-out
        hub.stop()
    })
})
