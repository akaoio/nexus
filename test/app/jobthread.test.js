/**
 * The job thread + the "plane" pseudo-thread RPC (clauses THR-*).
 * A REAL Node worker_thread runs the job handlers off the main thread; the
 * ONLY way a handler reaches data is the narrow 4-op plane RPC, executed on
 * a real in-memory plane under a job-scoped ctx — never god-mode (THR-04).
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { SYSTEM_ENTITIES } from "../../src/core/App/system.js"
import { startJobThread, bindPlaneRpc } from "../../src/core/App/jobthread.js"

const CTX = { user: "admin", roles: [], shares: [], policies: [{ entity: "nexus_notification", actions: ["read", "create", "write", "delete"], rule: null, permlevel: 0, ifOwner: false }] }
const ADMIN_CTX = { user: "admin", roles: [], shares: [], policies: [{ entity: "nexus_user", actions: ["read", "create", "write", "delete"], rule: null, permlevel: 0, ifOwner: false }] }
// The job thread's own ctx: exactly what the fixture's handlers are allowed
// to touch — create/read on nexus_notification, nothing on nexus_user.
const JOB_CTX = { user: "job", roles: [], shares: [], policies: [{ entity: "nexus_notification", actions: ["read", "create"], rule: null, permlevel: 0, ifOwner: false }] }

function makePlane() {
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const schema of SYSTEM_ENTITIES)
        for (const builder of tableDDL(kysely, schema)) db.exec(builder.compile().sql)
    const executor = {
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: (sql, params = []) => db.prepare(sql).all(...params)
    }
    return new DataPlane({ executor, schemas: SYSTEM_ENTITIES, dialect: "sqlite" })
}

Test.describe("Job thread + plane pseudo-thread RPC (THR-*)", () => {
    // One real worker thread + one bound plane RPC for the whole suite — but
    // built LAZILY: a filtered run that skips every clause in this suite must
    // never spawn a worker. `ensureRig()` builds it on first use and memoizes
    // via `rigReady`, so setup still runs exactly once no matter which clause
    // executes first.
    async function buildRig() {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-jobthread-"))
        mkdirSync(join(scratch, "apps", "fx"), { recursive: true })
        writeFileSync(
            join(scratch, "apps", "fx", "hooks.js"),
            `export default ({ job }) => {
    job("fx.echo", { run: async ({ payload }) => ({ echoed: payload.msg }) })
    job("fx.boom", { run: async () => { throw new Error("boom in thread") } })
    job("fx.note", { run: async ({ payload }, { plane }) => plane.create("nexus_notification", { user: payload.user, title: "hi", read: false }) })
    job("fx.forbidden", { run: async (_, { plane }) => plane.create("nexus_user", { pub: "evil", name: "evil" }) })
    job("fx.count", { run: async ({ payload }, { plane }) => ({ n: (await plane.list("nexus_notification", payload.filter)).length }) })
}
`
        )
        const plane = makePlane()
        // The name comes FROM the binding and is handed to the thread. Two
        // independent defaults would have to agree; this one cannot disagree.
        const { planeName } = bindPlaneRpc(plane, JOB_CTX)
        const jobRig = await startJobThread({ root: scratch, apps: [{ dir: "fx" }], config: {}, planeName })
        return { ...jobRig, plane, scratch }
    }

    let rigReady = null
    const ensureRig = () => (rigReady ??= buildRig())

    Test.it("THR-01 a handler executes in a REAL worker thread and returns its result", async () => {
        const rig = await ensureRig()
        const result = await rig.execute({ id: "j1", name: "fx.echo", payload: { msg: "xin chào" } })
        assert.equal(result.echoed, "xin chào")
    })

    Test.it("THR-02 a handler throw rejects execute with the thread's error message", async () => {
        const rig = await ensureRig()
        let error = null
        try { await rig.execute({ id: "j2", name: "fx.boom", payload: {} }) } catch (e) { error = e }
        assert.truthy(String(error.message).includes("boom in thread"))
    })

    Test.it("THR-03 plane-RPC: the thread creates a row through the narrow seam", async () => {
        const rig = await ensureRig()
        await rig.execute({ id: "j3", name: "fx.note", payload: { user: "pubX" } })
        const rows = await rig.plane.list("nexus_notification", {}, CTX)
        assert.equal(rows.length, 1)
        assert.equal(rows[0].user, "pubX")
    })

    Test.it("THR-04 plane-RPC is NOT god-mode: the job ctx denies system-entity writes", async () => {
        const rig = await ensureRig()
        let error = null
        try { await rig.execute({ id: "j4", name: "fx.forbidden", payload: {} }) } catch (e) { error = e }
        assert.truthy(error, "the write must be refused")
        assert.equal((await rig.plane.list("nexus_user", {}, ADMIN_CTX)).length, 0)
    })

    Test.it("THR-05 plane-RPC list carries the filter through (and get reads a single row)", async () => {
        const rig = await ensureRig()
        const rowU1 = await rig.execute({ id: "j5a", name: "fx.note", payload: { user: "u1" } })
        await rig.execute({ id: "j5b", name: "fx.note", payload: { user: "u2" } })
        const { n } = await rig.execute({ id: "j5c", name: "fx.count", payload: { filter: { astVersion: 1, root: { field: "user", operator: "eq", value: "u1" } } } })
        assert.equal(n, 1)
        const fetched = await rig.plane.get("nexus_notification", rowU1.id, CTX)
        assert.equal(fetched.user, "u1")
    })

    Test.it("THR cleanup: the worker terminates and the suite exits clean", async () => {
        const rig = await ensureRig()
        await rig.stop()
        rmSync(rig.scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
})
