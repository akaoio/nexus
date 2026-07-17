/**
 * Sync checkpoint & compaction conformance (SYNC-C) — docs/sync-design.md §8/§9.
 * Written to the design's own clause: "stateRoot khớp ↔ được prune; lệch →
 * không prune + báo; event muộn hơn checkpoint xử lý đúng §8."
 *
 * Everything here is real and local: real ZEN keys sign the checkpoint (the
 * arbiter role), a real SQLite engine holds the log, the state root is a real
 * Merkle root recomputed by each peer. The snapshot BLOB transport (Torrent/
 * RTC of the file layer) is out of scope — the checkpoint LOGIC (root match →
 * prune, bootstrap-from-snapshot, late-event handling) is proven here.
 */

import Test, { assert } from "../../src/kernel/Test.js"
import Sync from "./_load.js"
import { schema, field } from "../conformance/model/_helpers.js"

const ZEN = (await import("../../vendor/zen/zen.js")).default
const TASK = schema({
    name: "task",
    fields: [field("title", "text", { required: true }), field("done", "boolean", { default: false }), field("points", "integer")]
})

let ARB = null
let AUTHOR = null
const arbiter = async () => (ARB ??= await ZEN.pair(null, { seed: "nexus-checkpoint-arbiter" }))
const author = async () => (AUTHOR ??= await ZEN.pair(null, { seed: "nexus-checkpoint-author" }))

async function makeEngine(overrides = {}) {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(":memory:")
    const executor = {
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: (sql, params = []) => db.prepare(sql).all(...params)
    }
    const engine = new Sync.SyncEngine({ executor, dialect: "sqlite", schemas: [TASK], site: "s1", ...overrides })
    await engine.ready
    return { engine, executor }
}

/** Append r1(create,update) then r2(create); checkpoint the horizon at the r1 update. */
async function seeded(overrides = {}) {
    const arb = await arbiter()
    const auth = await author()
    const { engine, executor } = await makeEngine({ arbiter: arb.pub, ...overrides })
    const e1 = (await engine.append({ op: "create", entity: "task", rowId: "r1", data: { title: "a" } }, auth)).event
    const e2 = (await engine.append({ op: "update", entity: "task", rowId: "r1", data: { done: true } }, auth)).event
    const e3 = (await engine.append({ op: "create", entity: "task", rowId: "r2", data: { title: "b" } }, auth)).event
    const { checkpoint, snapshot } = await engine.createCheckpoint(e2.ts, arb)
    return { engine, executor, arb, auth, e1, e2, e3, checkpoint, snapshot, upto: e2.ts }
}

const count = (ex, sql, p = []) => ex.all(sql, p)[0].n

Test.describe("Sync — checkpoint & compaction (SYNC-C)", () => {
    Test.it("SYNC-C01 stateRoot MATCHES → events ≤ upto are pruned; folded rows stay intact", async () => {
        const { engine, executor, checkpoint } = await seeded()
        assert.equal(count(executor, `SELECT COUNT(*) AS n FROM _nexus_events`), 3)

        const result = await engine.applyCheckpoint(checkpoint)
        assert.equal(result.status, "pruned")
        assert.equal(result.pruned, 2) // e1 + e2 (≤ upto); e3 is after the horizon

        assert.equal(count(executor, `SELECT COUNT(*) AS n FROM _nexus_events`), 1) // only e3 remains
        const r1 = executor.all(`SELECT * FROM task WHERE id = 'r1'`)[0]
        assert.equal(r1.title, "a")
        assert.equal(r1.done, 1) // the pruned update survives in the checkpoint base
        assert.equal(executor.all(`SELECT * FROM task WHERE id = 'r2'`)[0].title, "b")
    })

    Test.it("SYNC-C02 refold after prune folds from the base — a new event still lands correctly", async () => {
        const { engine, executor, checkpoint, auth } = await seeded()
        await engine.applyCheckpoint(checkpoint)
        // an update to r1 AFTER the horizon: base (title a, done true) + this event
        await engine.append({ op: "update", entity: "task", rowId: "r1", data: { title: "a2" } }, auth)
        const r1 = executor.all(`SELECT * FROM task WHERE id = 'r1'`)[0]
        assert.equal(r1.title, "a2")
        assert.equal(r1.done, 1) // came from the pruned base, not from a live event
    })

    Test.it("SYNC-C03 stateRoot MISMATCH → divergent alert, NEVER prune", async () => {
        const { checkpoint, upto } = await seeded()
        // a peer with a DIFFERENT history for the same horizon
        const arb = await arbiter()
        const other = await makeEngine({ arbiter: arb.pub })
        await other.engine.append({ op: "create", entity: "task", rowId: "r1", data: { title: "DIFFERENT" } }, await author())
        const before = count(other.executor, `SELECT COUNT(*) AS n FROM _nexus_events`)

        const result = await other.engine.applyCheckpoint(checkpoint)
        assert.equal(result.status, "divergent")
        assert.notEqual(result.localRoot, result.checkpointRoot)
        assert.equal(count(other.executor, `SELECT COUNT(*) AS n FROM _nexus_events`), before) // nothing pruned
        void upto
    })

    Test.it("SYNC-C04 no configured arbiter → NEVER prune (disk is cheaper than data)", async () => {
        const { checkpoint } = await seeded()
        const peer = await makeEngine() // arbiter: null
        await peer.engine.append({ op: "create", entity: "task", rowId: "r1", data: { title: "a" } }, await author())
        const before = count(peer.executor, `SELECT COUNT(*) AS n FROM _nexus_events`)
        const result = await peer.engine.applyCheckpoint(checkpoint)
        assert.equal(result.status, "no-arbiter")
        assert.equal(count(peer.executor, `SELECT COUNT(*) AS n FROM _nexus_events`), before)
    })

    Test.it("SYNC-C05 a checkpoint NOT signed by the site arbiter is rejected", async () => {
        const { engine, upto } = await seeded()
        const impostor = await ZEN.pair()
        const forged = await engine.createCheckpoint(upto, impostor) // signed by the wrong key
        const result = await engine.applyCheckpoint(forged.checkpoint)
        assert.equal(result.status, "rejected")
        assert.truthy(result.reason.includes("E_CHECKPOINT_SIG"))
    })

    Test.it("SYNC-C06 an event below a pruned horizon: covered → duplicate, uncovered → quarantine (never swallowed)", async () => {
        const { engine, e1, upto, checkpoint } = await seeded()
        await engine.applyCheckpoint(checkpoint) // prunes e1, e2 (≤ upto)
        // covered: e1 was folded into the snapshot → re-delivery is a no-op duplicate
        assert.equal((await engine.ingest(e1)).status, "duplicate")
        // uncovered: a brand-new event with an HLC ≤ the horizon → historical conflict
        const late = await Sync.createEvent(
            { site: "s1", entity: "task", op: "update", rowId: "r1", data: { title: "SNUCK_IN" }, schemaVersion: 1, ts: { millis: upto.millis, counter: 0 } },
            await author()
        )
        const result = await engine.ingest(late)
        assert.equal(result.status, "quarantined")
        assert.truthy(result.reason.includes("E_HISTORICAL"))
        assert.equal((await engine.quarantined()).length, 1)
    })

    Test.it("SYNC-C07 BOOTSTRAP: a fresh peer loads the snapshot after verifying arbiter, ref, and state root", async () => {
        const { checkpoint, snapshot } = await seeded()
        const fresh = await makeEngine({ arbiter: (await arbiter()).pub })
        const result = await fresh.engine.bootstrapFromCheckpoint(checkpoint, snapshot)
        assert.equal(result.status, "bootstrapped")
        // the row folded at the horizon is present without replaying any event
        const r1 = fresh.executor.all(`SELECT * FROM task WHERE id = 'r1'`)[0]
        assert.equal(r1.title, "a")
        assert.equal(r1.done, 1)
        assert.equal(count(fresh.executor, `SELECT COUNT(*) AS n FROM _nexus_events`), 0)
    })

    Test.it("SYNC-C08 BOOTSTRAP rejects a tampered snapshot (state root no longer matches)", async () => {
        const { checkpoint, snapshot } = await seeded()
        const tampered = { ...snapshot, states: snapshot.states.map((s) => (s.rowId === "r1" ? { ...s, state: { ...s.state, title: "HIJACKED" } } : s)) }
        const fresh = await makeEngine({ arbiter: (await arbiter()).pub })
        const result = await fresh.engine.bootstrapFromCheckpoint(checkpoint, tampered)
        assert.equal(result.status, "rejected")
        assert.truthy(["E_SNAPSHOT_REF", "E_STATE_ROOT"].some((code) => result.reason.includes(code)))
    })
})
