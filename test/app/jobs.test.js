/**
 * The effect engine core (JOB-*) — claim/ack/retry/DLQ over ordinary
 * nexus_job rows. Exercised full-stack on a real in-memory SQLite plane so
 * the token-CAS claim, backoff schedule, DLQ, recurring reschedule and
 * crash recovery are all proven against the real executor contract, never
 * a mock. All timing rides an injectable clock — no test sleeps.
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { SYSTEM_ENTITIES } from "../../src/core/App/system.js"
import { backoffMs, enqueue, claimNext, runnerTick } from "../../src/core/App/jobs.js"

let clock = 1_000_000
const now = () => clock

const CTX = {
    user: "t", roles: [], shares: [],
    policies: [{ entity: "nexus_job", actions: ["read", "create", "write", "delete"], rule: null, permlevel: 0, ifOwner: false }]
}

function makePlane() {
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const schema of SYSTEM_ENTITIES)
        for (const builder of tableDDL(kysely, schema)) db.exec(builder.compile().sql)
    const executor = {
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: (sql, params = []) => db.prepare(sql).all(...params)
    }
    // Share the SAME injectable clock with the plane — jobs.js defaults
    // run_at to the plane's own now(), never wall-clock Date.now().
    return new DataPlane({ executor, schemas: SYSTEM_ENTITIES, dialect: "sqlite", now })
}

Test.describe("Effect engine core — claim/lifecycle (JOB-*)", () => {
    // Each test resets the clock and builds a fresh in-memory plane — no
    // shared state, no auto-discovery, ordinary function calls.
    const setup = () => { clock = 1_000_000; return makePlane() }

    Test.it("JOB-01 enqueue lands a pending row with defaults", async () => {
        const plane = setup()
        const row = await enqueue(plane, CTX, "t.echo", { x: 1 })
        assert.equal(row.status, "pending")
        assert.equal(row.max_attempts, 5)
        assert.equal(JSON.parse(row.payload).x, 1)
    })

    Test.it("JOB-02 claim: one due job, one winner — the second claim gets null", async () => {
        const plane = setup()
        await enqueue(plane, CTX, "t.solo", {})
        const a = await claimNext(plane, { now })
        const b = await claimNext(plane, { now })
        assert.equal(a.name, "t.solo")
        assert.equal(b, null) // CAS: same row cannot be claimed twice inside the lease
    })

    Test.it("JOB-03 run_at gates the claim; the injectable clock releases it", async () => {
        const plane = setup()
        await enqueue(plane, CTX, "t.later", {}, { runAt: new Date(clock + 60_000).toISOString() })
        assert.equal(await claimNext(plane, { now }), null)
        clock += 61_000
        assert.equal((await claimNext(plane, { now })).name, "t.later")
    })

    Test.it("JOB-04 failure → backoff schedule → dead after max_attempts (the DLQ)", async () => {
        const plane = setup()
        const row = await enqueue(plane, CTX, "t.boom", {}, { maxAttempts: 2 })
        const jobs = new Map([["t.boom", {}]])
        const boom = async () => { throw new Error("kaput") }
        assert.equal(await runnerTick(plane, { now, jobs, execute: boom, ctx: CTX }), true) // attempt 1 → failed
        let r = await plane.get("nexus_job", row.id, CTX)
        assert.equal(r.status, "failed")
        assert.truthy(r.last_error.includes("kaput"))
        assert.equal(new Date(r.run_at).getTime(), clock + backoffMs(1)) // backoff pins the schedule
        clock = new Date(r.run_at).getTime() + 1
        await runnerTick(plane, { now, jobs, execute: boom, ctx: CTX }) // attempt 2 → dead
        r = await plane.get("nexus_job", row.id, CTX)
        assert.equal(r.status, "dead")
    })

    Test.it("JOB-05 success acks; every_ms reschedules the SAME row with attempts reset", async () => {
        const plane = setup()
        const once = await enqueue(plane, CTX, "t.ok", {})
        const cyc = await enqueue(plane, CTX, "t.cycle", {}, { everyMs: 5000 })
        const jobs = new Map([["t.ok", {}], ["t.cycle", {}]])
        const okRun = async () => ({ ran: true })
        await runnerTick(plane, { now, jobs, execute: okRun, ctx: CTX })
        await runnerTick(plane, { now, jobs, execute: okRun, ctx: CTX })
        const one = await plane.get("nexus_job", once.id, CTX)
        assert.equal(one.status, "done")
        assert.equal(JSON.parse(one.result).ran, true)
        const cy = await plane.get("nexus_job", cyc.id, CTX)
        assert.equal(cy.status, "pending") // recurring: same row, back to pending
        assert.equal(cy.attempts, 0)
        assert.equal(new Date(cy.run_at).getTime(), clock + 5000)
    })

    Test.it("JOB-07 crash recovery: a running row with an EXPIRED lease is reclaimable; a live lease blocks", async () => {
        const plane = setup()
        const row = await enqueue(plane, CTX, "t.crash", {})
        const first = await claimNext(plane, { now })
        assert.equal(first.id, row.id) // claimed → running, leased
        assert.equal(await claimNext(plane, { now }), null) // live lease blocks
        clock += 61_000 // LEASE_MS is 60000 — the thread died, the lease expired
        const again = await claimNext(plane, { now })
        assert.equal(again.id, row.id) // reclaimed, no extra machinery
        assert.equal(again.status, "running")
    })

    Test.it("JOB-06 poison fails LOUD: unknown handler → dead E_HANDLER; unparseable payload → dead E_PAYLOAD", async () => {
        const plane = setup()
        const ghost = await enqueue(plane, CTX, "t.ghost", {})
        await runnerTick(plane, { now, jobs: new Map(), execute: async () => ({}), ctx: CTX })
        assert.equal((await plane.get("nexus_job", ghost.id, CTX)).status, "dead")
        assert.truthy((await plane.get("nexus_job", ghost.id, CTX)).last_error.includes("E_HANDLER"))
        const bad = await plane.create("nexus_job", { name: "t.raw", payload: "{not json", status: "pending", run_at: new Date(clock).toISOString(), attempts: 0, max_attempts: 5 }, CTX)
        await runnerTick(plane, { now, jobs: new Map([["t.raw", {}]]), execute: async () => ({}), ctx: CTX })
        assert.equal((await plane.get("nexus_job", bad.id, CTX)).status, "dead")
        assert.truthy((await plane.get("nexus_job", bad.id, CTX)).last_error.includes("E_PAYLOAD"))
    })
})
