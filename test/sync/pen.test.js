/**
 * Gate 3 — PEN policy conformance (SYNC-P3) — docs/sync-design.md §3/§5.
 * The permission's entity set is compiled to a REAL ZEN PEN policy (pen.wasm)
 * and evaluated by ZEN's policy VM: a structurally-invalid write (malformed
 * soul, unknown entity, wrong site) is rejected at the graph layer — the same
 * bytecode a plain relay would enforce, no re-implemented check.
 *
 * Honest boundary (§6): PEN here is the structural/entity-level gate; per-author
 * row/field rules stay gate 4. This suite proves the compile target is real
 * (ZEN's VM accepts/rejects) and that the engine's gate 3 fires before gate 4.
 */

import Test, { assert } from "../../src/kernel/Test.js"
import Sync from "./_load.js"
import { compileEntityPolicy, authorizeWrite, logSoul } from "../../src/sync/PenPolicy.js"
import { schema, field } from "../conformance/model/_helpers.js"

const ZEN = (await import("../../vendor/zen/zen.js")).default
const TASK = schema({ name: "task", fields: [field("title", "text", { required: true }), field("done", "boolean", { default: false })] })

let PAIR = null
const pair = async () => (PAIR ??= await ZEN.pair(null, { seed: "nexus-pen-author" }))

async function makeEngine(overrides = {}) {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(":memory:")
    const executor = { run: (s, p = []) => void db.prepare(s).run(...p), all: (s, p = []) => db.prepare(s).all(...p) }
    const engine = new Sync.SyncEngine({ executor, dialect: "sqlite", schemas: [TASK], site: "s1", ...overrides })
    await engine.ready
    return { engine, executor }
}

Test.describe("Sync — gate 3 PEN policy (SYNC-P3)", () => {
    Test.it("SYNC-P3-01 compiles to REAL ZEN PEN bytecode; the VM accepts known entities, rejects the rest", async () => {
        const { policy, bytecode } = await compileEntityPolicy({ site: "s1", entities: ["task", "note"] })
        assert.truthy(policy.startsWith("!")) // ZEN PEN policy-soul prefix
        assert.truthy(bytecode.length > 0)
        assert.equal(await authorizeWrite(bytecode, logSoul("s1", "task", "e1")), true)
        assert.equal(await authorizeWrite(bytecode, logSoul("s1", "note", "e2")), true)
        assert.equal(await authorizeWrite(bytecode, logSoul("s1", "secret", "e3")), false) // unknown entity
        assert.equal(await authorizeWrite(bytecode, logSoul("s2", "task", "e4")), false) // wrong site
        assert.equal(await authorizeWrite(bytecode, "nexus/s1/rows/task/e5"), false) // wrong subtree
        assert.equal(await authorizeWrite(bytecode, "garbage/path"), false) // malformed
    })

    Test.it("SYNC-P3-02 a valid write passes gate 3 and applies normally", async () => {
        const { engine, executor } = await makeEngine({ penGate: true })
        const { result } = await engine.append({ op: "create", entity: "task", rowId: "r1", data: { title: "ok" } }, await pair())
        assert.equal(result.status, "applied")
        assert.equal(executor.all(`SELECT title FROM task`)[0].title, "ok")
    })

    Test.it("SYNC-P3-03 an unknown entity is REJECTED at gate 3 — it never reaches gate 4 quarantine", async () => {
        const { engine } = await makeEngine({ penGate: true })
        const ghost = await Sync.createEvent(
            { site: "s1", entity: "ghost", op: "create", rowId: "r1", data: {}, schemaVersion: 1, ts: { millis: 1, counter: 0 } },
            await pair()
        )
        const result = await engine.ingest(ghost)
        assert.equal(result.status, "rejected")
        assert.truthy(result.reason.includes("E_PEN"))
        assert.equal((await engine.quarantined()).length, 0) // gate 4 was never reached
    })

    Test.it("SYNC-P3-04 a foreign-site event for a known entity is rejected by the graph write policy", async () => {
        const { engine } = await makeEngine({ penGate: true })
        const foreign = await Sync.createEvent(
            { site: "OTHER", entity: "task", op: "create", rowId: "r1", data: { title: "x" }, schemaVersion: 1, ts: { millis: 1, counter: 0 } },
            await pair()
        )
        const result = await engine.ingest(foreign)
        assert.equal(result.status, "rejected")
        assert.truthy(result.reason.includes("E_PEN"))
    })

    Test.it("SYNC-P3-05 with the gate OFF (default), the engine behaves exactly as before", async () => {
        const { engine, executor } = await makeEngine() // penGate defaults to false
        await engine.append({ op: "create", entity: "task", rowId: "r1", data: { title: "plain" } }, await pair())
        assert.equal(executor.all(`SELECT title FROM task`)[0].title, "plain")
    })
})
