/**
 * Sync conformance — ZEN event log → SQL projection (SYNC-*), the
 * docs/sync-design.md §11 catalogue. Written RED-FIRST per that document's
 * closing rule. Runs against real ZEN keys (vendored, secp256k1) and a real
 * SQLite engine.
 *
 * THE clause is SYNC-Q01: k peers receiving the same event set in k
 * different arrival orders converge to byte-identical tables — confluence
 * as a structural property.
 *
 * Deferred with the design's own words: checkpoints/pruning (SYNC-C — needs
 * the arbiter role and snapshot distribution) and the PEN graph gate
 * (gate 3 — Nexus's gate 4 re-checks permission regardless).
 */

import Test, { assert } from "../../src/kernel/Test.js"
import Sync from "./_load.js"
import { schema, field } from "../conformance/model/_helpers.js"
import { prng } from "../conformance/ast/_helpers.js"

const ZEN = (await import("../../vendor/zen/zen.js")).default
const TASK = schema({
    name: "task",
    fields: [field("title", "text", { required: true }), field("done", "boolean", { default: false }), field("points", "integer")]
})

// A DETERMINISTIC keypair for the whole suite: seeded, so every run signs
// identical events and failures reproduce. In production this seed is the
// hash of a WebAuthn credential (no hardware in a headless test — the seed
// stands in for it); the derivation is the same ZEN.pair(seed) either way.
let PAIR = null
const pair = async () => (PAIR ??= await ZEN.pair(null, { seed: "nexus-sync-test-author" }))

async function makeEngine(overrides = {}) {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(":memory:")
    const executor = {
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: (sql, params = []) => db.prepare(sql).all(...params)
    }
    const engine = new Sync.SyncEngine({ executor, dialect: "sqlite", schemas: [TASK], site: "s1", ...overrides })
    await engine.ready
    return { engine, executor, db }
}

const rowsOf = (executor) => executor.all(`SELECT * FROM task ORDER BY id`)

Test.describe("Sync — event format (SYNC-E)", () => {
    Test.it("SYNC-E01 canonical form sorts keys and excludes id/sig — stable across insertion order", async () => {
        const a = Sync.canonical({ eventVersion: 1, op: "create", entity: "task", site: "s1", rowId: "R1", data: { title: "x" }, group: null, author: "A", ts: { millis: 5, counter: 0 }, schemaVersion: 1, id: "IGNORED", sig: "IGNORED" })
        const b = Sync.canonical({ sig: "OTHER", ts: { counter: 0, millis: 5 }, author: "A", data: { title: "x" }, group: null, rowId: "R1", site: "s1", entity: "task", op: "create", eventVersion: 1, schemaVersion: 1 })
        assert.equal(a, b)
        assert.equal(a.includes("IGNORED"), false)
    })

    Test.it("SYNC-E02 the id is the content address — any mutation breaks verification", async () => {
        const event = await Sync.createEvent({ site: "s1", entity: "task", op: "create", rowId: "R1", data: { title: "x" }, schemaVersion: 1, ts: { millis: 1, counter: 0 } }, await pair())
        assert.equal(await Sync.verifyEvent(event), true)
        const forgedData = { ...event, data: { title: "FORGED" } }
        assert.equal(await Sync.verifyEvent(forgedData), false)
        const forgedId = { ...event, id: event.id.slice(0, -1) + (event.id.at(-1) === "a" ? "b" : "a") }
        assert.equal(await Sync.verifyEvent(forgedId), false)
    })

    Test.it("SYNC-E03 signatures bind the author — a different key cannot speak for them", async () => {
        const event = await Sync.createEvent({ site: "s1", entity: "task", op: "create", rowId: "R1", data: { title: "x" }, schemaVersion: 1, ts: { millis: 1, counter: 0 } }, await pair())
        assert.equal(event.author, (await pair()).pub)
        const impostor = await ZEN.pair()
        const stolen = { ...event, author: impostor.pub }
        assert.equal(await Sync.verifyEvent(stolen), false)
    })

    Test.it("SYNC-E04 a foreign eventVersion is rejected loudly, never guessed", async () => {
        const { engine } = await makeEngine()
        const event = await Sync.createEvent({ site: "s1", entity: "task", op: "create", rowId: "R1", data: { title: "x" }, schemaVersion: 1, ts: { millis: 1, counter: 0 } }, await pair())
        const result = await engine.ingest({ ...event, eventVersion: 2 })
        assert.equal(result.status, "rejected")
        assert.truthy(result.reason.includes("E_VERSION"))
    })
})

Test.describe("Sync — ordering (SYNC-O)", () => {
    Test.it("SYNC-O01 the HLC never runs backwards; same-millis ticks bump the counter", () => {
        const clock = new Sync.HLC()
        const t1 = clock.next(1000)
        const t2 = clock.next(1000)
        const t3 = clock.next(500) // physical clock regressed
        assert.deepEqual([t1.millis, t1.counter], [1000, 0])
        assert.deepEqual([t2.millis, t2.counter], [1000, 1])
        assert.deepEqual([t3.millis, t3.counter], [1000, 2], "never backwards")
        clock.receive({ millis: 2000, counter: 5 })
        const t4 = clock.next(1500)
        assert.truthy(t4.millis === 2000 && t4.counter > 5, "merges the remote maximum")
    })

    Test.it("SYNC-O02 the total-order key has no ties: millis, counter, author, id", () => {
        const compare = Sync.compareEvents
        const e = (millis, counter, author, id) => ({ ts: { millis, counter }, author, id })
        assert.truthy(compare(e(1, 0, "A", "x"), e(2, 0, "A", "x")) < 0)
        assert.truthy(compare(e(1, 1, "A", "x"), e(1, 0, "A", "x")) > 0)
        assert.truthy(compare(e(1, 0, "A", "x"), e(1, 0, "B", "x")) < 0)
        assert.truthy(compare(e(1, 0, "A", "x"), e(1, 0, "A", "y")) < 0)
        assert.equal(compare(e(1, 0, "A", "x"), e(1, 0, "A", "x")), 0)
    })
})

Test.describe("Sync — fold (SYNC-F)", () => {
    Test.it("SYNC-F01 create/update/delete fold onto the real engine", async () => {
        const { engine, executor } = await makeEngine()
        const created = await engine.append({ entity: "task", op: "create", rowId: "R1", data: { title: "born" } }, await pair())
        assert.equal(created.event.op, "create")
        assert.equal(rowsOf(executor)[0].title, "born")
        assert.equal(rowsOf(executor)[0].owner, (await pair()).pub)
        await engine.append({ entity: "task", op: "update", rowId: "R1", data: { done: true } }, await pair())
        assert.equal(rowsOf(executor)[0].done, 1)
        await engine.append({ entity: "task", op: "delete", rowId: "R1", data: {} }, await pair())
        assert.deepEqual(rowsOf(executor), [])
    })

    Test.it("SYNC-F02 field-level LWW: disjoint updates both live; same-field later HLC wins", async () => {
        const { engine, executor } = await makeEngine()
        await engine.append({ entity: "task", op: "create", rowId: "R1", data: { title: "base" } }, await pair())
        await engine.append({ entity: "task", op: "update", rowId: "R1", data: { done: true } }, await pair())
        await engine.append({ entity: "task", op: "update", rowId: "R1", data: { points: 5 } }, await pair())
        const row = rowsOf(executor)[0]
        assert.equal(row.done, 1)
        assert.equal(row.points, 5)
        await engine.append({ entity: "task", op: "update", rowId: "R1", data: { points: 9 } }, await pair())
        assert.equal(rowsOf(executor)[0].points, 9)
    })

    Test.it("SYNC-F03 update-before-create: the partial row waits; create completes it", async () => {
        const { engine: source } = await makeEngine()
        const { engine: sink, executor } = await makeEngine()
        const created = await source.append({ entity: "task", op: "create", rowId: "R1", data: { title: "late" } }, await pair())
        const updated = await source.append({ entity: "task", op: "update", rowId: "R1", data: { points: 7 } }, await pair())
        await sink.ingest(updated.event) // update arrives FIRST
        assert.deepEqual(rowsOf(executor), [], "no base row yet — nothing is written")
        await sink.ingest(created.event)
        const row = rowsOf(executor)[0]
        assert.equal(row.title, "late")
        assert.equal(row.points, 7)
    })
})

Test.describe("Sync — properties (SYNC-Q)", () => {
    Test.it("SYNC-Q01 CONFLUENCE: k arrival orders → byte-identical tables", async () => {
        const rnd = prng(0xc0f)
        const { engine: source } = await makeEngine()
        const events = []
        const capture = async (spec) => events.push((await source.append(spec, await pair())).event)
        for (let r = 0; r < 5; r++) await capture({ entity: "task", op: "create", rowId: `R${r}`, data: { title: `row ${r}` } })
        for (let i = 0; i < 20; i++) {
            const rowId = `R${Math.floor(rnd() * 5)}`
            if (rnd() < 0.15) await capture({ entity: "task", op: "delete", rowId, data: {} })
            else await capture({ entity: "task", op: "update", rowId, data: rnd() < 0.5 ? { points: Math.floor(rnd() * 100) } : { done: rnd() < 0.5 } })
        }
        const snapshots = []
        for (let k = 0; k < 4; k++) {
            const order = [...events]
            for (let i = order.length - 1; i > 0; i--) {
                const j = Math.floor(rnd() * (i + 1))
                ;[order[i], order[j]] = [order[j], order[i]]
            }
            const { engine, executor } = await makeEngine()
            for (const event of order) await engine.ingest(event)
            snapshots.push(JSON.stringify(rowsOf(executor)))
        }
        for (const snapshot of snapshots) assert.equal(snapshot, snapshots[0], "every arrival order must converge")
    })

    Test.it("SYNC-Q02 redelivery is a no-op — the applied ledger holds", async () => {
        const { engine: source } = await makeEngine()
        const { engine, executor } = await makeEngine()
        const created = await source.append({ entity: "task", op: "create", rowId: "R1", data: { title: "once" } }, await pair())
        assert.equal((await engine.ingest(created.event)).status, "applied")
        assert.equal((await engine.ingest(created.event)).status, "duplicate")
        assert.equal(rowsOf(executor).length, 1)
    })
})

Test.describe("Sync — verification gates (SYNC-V)", () => {
    Test.it("SYNC-V01 gates 1+2: tampered signatures and ids never ingest", async () => {
        const { engine: source } = await makeEngine()
        const { engine, executor } = await makeEngine()
        const created = await source.append({ entity: "task", op: "create", rowId: "R1", data: { title: "true" } }, await pair())
        const tampered = { ...created.event, data: { title: "FORGED" } }
        const result = await engine.ingest(tampered)
        assert.equal(result.status, "rejected")
        assert.deepEqual(rowsOf(executor), [])
    })

    Test.it("SYNC-V02 gate 4 quarantines (never discards); retry heals after the world changes", async () => {
        const { engine: source } = await makeEngine()
        const deny = { status: "denied" }
        let allow = false
        const { engine, executor } = await makeEngine({
            policiesFor: () => (allow ? null : []) // null = trust-all; [] = deny-by-default
        })
        const created = await source.append({ entity: "task", op: "create", rowId: "R1", data: { title: "queued" } }, await pair())
        const first = await engine.ingest(created.event)
        assert.equal(first.status, "quarantined", JSON.stringify(first))
        assert.deepEqual(rowsOf(executor), [], "quarantined events never fold")
        assert.equal((await engine.quarantined()).length, 1)

        allow = true // policy change → retry heals
        const healed = await engine.retryQuarantine()
        assert.equal(healed.applied, 1)
        assert.equal(rowsOf(executor)[0].title, "queued")
        assert.equal((await engine.quarantined()).length, 0)
        void deny
    })

    Test.it("SYNC-V03 unknown entities and unknown fields quarantine with reasons", async () => {
        const { engine: source } = await makeEngine()
        const { engine } = await makeEngine()
        const ghost = await Sync.createEvent({ site: "s1", entity: "ghost", op: "create", rowId: "R1", data: {}, schemaVersion: 1, ts: { millis: 1, counter: 0 } }, await pair())
        assert.equal((await engine.ingest(ghost)).status, "quarantined")
        const badField = await source.append({ entity: "task", op: "create", rowId: "R2", data: { title: "x" } }, await pair())
        const mutated = await Sync.createEvent({ site: "s1", entity: "task", op: "create", rowId: "R3", data: { title: "x", ghost_field: 1 }, schemaVersion: 1, ts: { millis: 2, counter: 0 } }, await pair())
        assert.equal((await engine.ingest(mutated)).status, "quarantined")
        void badField
    })
})

Test.describe("Sync — migration on old logs (SYNC-M)", () => {
    Test.it("SYNC-M01 old schemaVersion events upgrade through the chain; future ones wait and heal", async () => {
        const upgraders = { task: { 1: (data) => ({ ...data, points: data.points ?? 0 }) } }
        const { engine, executor } = await makeEngine({ versions: { task: 2 }, upgraders })
        const old = await Sync.createEvent(
            { site: "s1", entity: "task", op: "create", rowId: "R1", data: { title: "vintage" }, schemaVersion: 1, ts: { millis: 1, counter: 0 } },
            await pair()
        )
        assert.equal((await engine.ingest(old)).status, "applied")
        assert.equal(rowsOf(executor)[0].points, 0, "the upgrader ran at fold time")

        const { engine: past } = await makeEngine({ versions: { task: 1 } })
        const future = await Sync.createEvent(
            { site: "s1", entity: "task", op: "create", rowId: "R9", data: { title: "from tomorrow" }, schemaVersion: 2, ts: { millis: 9, counter: 0 } },
            await pair()
        )
        assert.equal((await past.ingest(future)).status, "quarantined")
        past.versions.task = 2 // "the local migrate ran"
        assert.equal((await past.retryQuarantine()).applied, 1)
    })
})

Test.describe("Sync — two peers (SYNC-P)", () => {
    Test.it("SYNC-P01 a local append emits an event a second peer replays identically", async () => {
        const a = await makeEngine()
        const b = await makeEngine()
        a.engine.onemit = (event) => b.engine.ingest(event) // the in-memory bus
        await a.engine.append({ entity: "task", op: "create", rowId: "R1", data: { title: "mirrored" } }, await pair())
        await a.engine.append({ entity: "task", op: "update", rowId: "R1", data: { done: true } }, await pair())
        await new Promise((r) => setTimeout(r, 20))
        assert.equal(JSON.stringify(rowsOf(b.executor)), JSON.stringify(rowsOf(a.executor)))
    })
})
