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
    let scratch, plane, rig

    // One real worker thread + one bound plane RPC for the whole suite — the
    // IIFE starts immediately (synchronously, at describe-time) and each
    // clause awaits it before touching `rig`/`plane`, so setup runs exactly
    // once no matter which clause executes first.
    const ready = (async () => {
        scratch = mkdtempSync(join(tmpdir(), "nexus-jobthread-"))
        mkdirSync(join(scratch, "apps", "fx"), { recursive: true })
        writeFileSync(
            join(scratch, "apps", "fx", "hooks.js"),
            `export default ({ job }) => {
    job("fx.echo", { run: async ({ payload }) => ({ echoed: payload.msg }) })
    job("fx.boom", { run: async () => { throw new Error("boom in thread") } })
    job("fx.note", { run: async ({ payload }, { plane }) => plane.create("nexus_notification", { user: payload.user, title: "hi", read: false }) })
    job("fx.forbidden", { run: async (_, { plane }) => plane.create("nexus_user", { pub: "evil", name: "evil" }) })
}
`
        )
        plane = makePlane()
        bindPlaneRpc(plane, JOB_CTX)
        rig = await startJobThread({ root: scratch, apps: [{ dir: "fx" }], config: {} })
    })()

    Test.it("THR-01 a handler executes in a REAL worker thread and returns its result", async () => {
        await ready
        const result = await rig.execute({ id: "j1", name: "fx.echo", payload: { msg: "xin chào" } })
        assert.equal(result.echoed, "xin chào")
    })

    Test.it("THR-02 a handler throw rejects execute with the thread's error message", async () => {
        await ready
        let error = null
        try { await rig.execute({ id: "j2", name: "fx.boom", payload: {} }) } catch (e) { error = e }
        assert.truthy(String(error.message).includes("boom in thread"))
    })

    Test.it("THR-03 plane-RPC: the thread creates a row through the narrow seam", async () => {
        await ready
        await rig.execute({ id: "j3", name: "fx.note", payload: { user: "pubX" } })
        const rows = await plane.list("nexus_notification", {}, CTX)
        assert.equal(rows.length, 1)
        assert.equal(rows[0].user, "pubX")
    })

    Test.it("THR-04 plane-RPC is NOT god-mode: the job ctx denies system-entity writes", async () => {
        await ready
        let error = null
        try { await rig.execute({ id: "j4", name: "fx.forbidden", payload: {} }) } catch (e) { error = e }
        assert.truthy(error, "the write must be refused")
        assert.equal((await plane.list("nexus_user", {}, ADMIN_CTX)).length, 0)
    })

    Test.it("THR cleanup: the worker terminates and the suite exits clean", async () => {
        await ready
        await rig.stop()
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
})
