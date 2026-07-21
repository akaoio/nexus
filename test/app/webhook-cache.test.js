/**
 * Webhook dispatch stops full-scanning its own table (WH-CACHE-*) — issue #9's
 * "`fire()` full-scans `nexus_webhook` on every write to every entity".
 *
 * Every create, update and delete in the instance did
 * `plane.list("nexus_webhook", {}, ctx)` to discover subscriptions — a full
 * scan on the hot path of every write, on an instance that in the common case
 * has no webhooks at all.
 *
 * The fix is reuse, not new machinery: `server.js` already caches
 * `nexus_policy` and `nexus_user` and refreshes them through the same
 * after-hook mechanism apps use, which is what gives it "a Studio write is
 * instantly live, no restart". WH-CACHE-02 pins that the webhook cache
 * inherits that property rather than trading it away for the speed.
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import { DataPlane } from "../../src/core/Data.js"
import { Extensions } from "../../src/core/App/extensions.js"
import { SYSTEM_ENTITIES } from "../../src/core/App/system.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { handleTransaction } from "../../src/core/Data/transaction.js"
import effects from "../../src/core/App/effects.js"

const TASK = {
    schemaVersion: 1,
    name: "task",
    label: { en: "Task" },
    fields: [{ name: "title", type: "text", label: { en: "T" } }]
}

const all = (entity) => ({ entity, actions: ["read", "create", "write", "delete"], rule: null, permlevel: 0, ifOwner: false })
const CTX = {
    user: "nexus",
    roles: [],
    shares: [],
    policies: [all("task"), ...SYSTEM_ENTITIES.map((s) => all(s.name))]
}

/** A rig that counts how many times nexus_webhook is actually listed. */
function makeRig() {
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    const schemas = [TASK, ...SYSTEM_ENTITIES]
    for (const s of schemas) for (const b of tableDDL(kysely, s)) db.exec(b.compile().sql)
    const run = (sql, params = []) => void db.prepare(sql).run(...params)
    const rawAll = (sql, params = []) => db.prepare(sql).all(...params)
    const plane = new DataPlane({
        executor: { run, all: rawAll, transaction: handleTransaction(run, rawAll, "BEGIN IMMEDIATE") },
        schemas,
        dialect: "sqlite",
        hooks: null,
        now: () => "2026-07-21T00:00:00.000Z"
    })

    const counter = { scans: 0 }
    const realList = plane.list.bind(plane)
    plane.list = (entity, ...rest) => {
        if (entity === "nexus_webhook") counter.scans++
        return realList(entity, ...rest)
    }

    const extensions = new Extensions()
    plane.hooks = extensions
    const enqueued = []
    extensions.enqueue = (name, payload) => { enqueued.push({ name, payload }); return { id: `job-${enqueued.length}` } }
    effects(extensions.registrar(), { schemas, plane, ctx: CTX, config: {} })
    return { plane, extensions, counter, enqueued }
}

Test.describe("Webhook dispatch reads a cache (WH-CACHE)", () => {

    Test.it("WH-CACHE-01 the webhook table is read ONCE, not once per write — the scan leaves the hot path", async () => {
        const { plane, counter } = makeRig()
        counter.scans = 0

        for (let i = 0; i < 20; i++) await plane.create("task", { title: `t${i}` }, CTX)

        // One lazy load on the first write, then memory. The number that
        // matters is that it does not grow with the write count: at 20 writes
        // the old behaviour scored 20.
        assert.equal(counter.scans, 1, `twenty writes must cost one read, saw ${counter.scans}`)
    })

    Test.it("WH-CACHE-02 writing a webhook row makes it live IMMEDIATELY — the cache keeps the no-restart property, it does not trade it for speed", async () => {
        const { plane, counter, enqueued } = makeRig()

        await plane.create("nexus_webhook", {
            url: "https://example.com/hook",
            entity: "task",
            events: JSON.stringify(["after:create"]),
            enabled: true,
            secret: "s3cr3t"
        }, CTX)

        await plane.create("task", { title: "fires" }, CTX)
        assert.equal(enqueued.length, 1, "a webhook created a moment ago must already be dispatching")
        assert.equal(enqueued[0].name, "effects.webhook")

        // …and disabling it takes effect just as immediately.
        const [row] = await plane.list("nexus_webhook", {}, CTX)
        counter.scans = 0
        await plane.update("nexus_webhook", row.id, { enabled: false }, CTX)
        await plane.create("task", { title: "silent" }, CTX)
        assert.equal(enqueued.length, 1, "a disabled webhook must stop firing without a restart")
    })

    Test.it("WH-CACHE-03 a webhook row still only fires for its own entity and events", async () => {
        const { plane, enqueued } = makeRig()
        await plane.create("nexus_webhook", {
            url: "https://example.com/hook",
            entity: "task",
            events: JSON.stringify(["after:remove"]),
            enabled: true,
            secret: "s"
        }, CTX)

        const row = await plane.create("task", { title: "t" }, CTX)
        assert.equal(enqueued.length, 0, "create is not in its event list")

        await plane.remove("task", row.id, CTX)
        assert.equal(enqueued.length, 1, "remove is")
    })
})
