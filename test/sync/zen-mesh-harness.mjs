/**
 * ZEN mesh convergence harness — the REAL two-peer sync, run as its own
 * process. It is a child harness (spawned by zen-transport.test.js) for one
 * hard reason: the ZEN mesh holds background handles (multicast dgram, DHT
 * timers, WS sockets) that a peer/relay keeps open by design — a relay is a
 * long-lived process, not a function call. Isolating it in a child that
 * force-exits keeps the main test runner's natural exit intact.
 *
 * Nothing here is mocked: a real ZEN relay in its own subprocess, two
 * independent SyncEngines each on their own in-memory SQLite and their own
 * ZEN graph store, gossiping signed content-addressed events over real
 * WebSocket wire. It prints a single JSON line of results and exits 0.
 */

import { fileURLToPath } from "url"
import { spawn } from "child_process"
import { DatabaseSync } from "node:sqlite"
import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))
const ZEN = (await import(join(ROOT, "vendor/zen/index.js"))).default
const { SyncEngine } = await import(join(ROOT, "src/sync/Sync.js"))
const { createZenTransport } = await import(join(ROOT, "src/sync/ZenTransport.js"))
const { schema, field } = await import(join(ROOT, "test/conformance/model/_helpers.js"))

/** Spawn the vendored ZEN relay as its own process; resolve once it serves. */
async function startRelay(port, cwd) {
    const proc = spawn(process.execPath, [join(ROOT, "vendor/zen/relay.js"), String(port)], {
        cwd,
        stdio: ["ignore", "pipe", "ignore"]
    })
    await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("relay did not start in time")), 15000)
        proc.stdout.on("data", (chunk) => {
            if (String(chunk).includes("started on port")) {
                clearTimeout(timer)
                resolve()
            }
        })
        proc.on("exit", () => { clearTimeout(timer); reject(new Error("relay exited early")) })
    })
    return proc
}

const scratch = mkdtempSync(join(tmpdir(), "nexus-zen-"))
const SCHEMA = schema({ name: "task", fields: [field("title", "text", { required: true }), field("done", "boolean", { default: false })] })

function makeEngine() {
    const db = new DatabaseSync(":memory:")
    const executor = { run: (s, p = []) => void db.prepare(s).run(...p), all: (s, p = []) => db.prepare(s).all(...p) }
    return new SyncEngine({ executor, schemas: [SCHEMA], site: "s1" })
}

const rowOf = (engine, id) => engine.executor.all(`SELECT * FROM task WHERE id = ?`, [id])[0] ?? null
async function until(fn, ms = 8000, step = 150) {
    const stop = Date.now() + ms
    while (Date.now() < stop) {
        const v = fn()
        if (v) return v
        await new Promise((r) => setTimeout(r, step))
    }
    return fn()
}

const results = {}
let relay = null
try {
    // ── a real ZEN relay in its own process on an ephemeral-ish port ──────────
    const port = 39200 + Math.floor(Math.random() * 400)
    relay = await startRelay(port, scratch)
    const url = `http://127.0.0.1:${port}/zen`

    // A fresh channel per run keeps a persistent relay store from replaying a
    // previous run's events into this one.
    const channel = "mesh-" + Math.random().toString(36).slice(2, 10)

    // ── two independent peers: engine + ZEN graph + transport ─────────────────
    const A = makeEngine()
    const B = makeEngine()
    await A.ready
    await B.ready
    const tA = await createZenTransport({ peers: [url], file: join(scratch, "a"), channel })
    const tB = await createZenTransport({ peers: [url], file: join(scratch, "b"), channel })
    tA.attach(A)
    tB.attach(B)
    await new Promise((r) => setTimeout(r, 3000)) // let the WS wire meet the relay

    const pairA = await ZEN.pair()
    const pairB = await ZEN.pair()

    // ZSYNC-01 — a create on A projects onto B over the real mesh
    await A.append({ op: "create", entity: "task", rowId: "r1", data: { title: "from A", done: false } }, pairA)
    const b1 = await until(() => rowOf(B, "r1"), 20000)
    results.converge_a_to_b = b1?.title === "from A"

    // ZSYNC-02 — bidirectional: a create on B projects onto A
    await B.append({ op: "create", entity: "task", rowId: "r2", data: { title: "from B", done: true } }, pairB)
    const a2 = await until(() => rowOf(A, "r2"), 20000)
    results.converge_b_to_a = a2?.title === "from B" && a2?.done === 1

    // ZSYNC-03 — an update on A converges as an update on B (same row, not a dup)
    await A.append({ op: "update", entity: "task", rowId: "r1", data: { done: true } }, pairA)
    const b1u = await until(() => { const r = rowOf(B, "r1"); return r?.done === 1 ? r : null }, 20000)
    const b1count = B.executor.all(`SELECT COUNT(*) AS n FROM task WHERE id = ?`, ["r1"])[0].n
    results.update_converges = b1u?.done === 1 && b1count === 1

    // ZSYNC-04 — idempotent re-delivery: republish r1's create verbatim, no second row
    const r1create = JSON.parse(A.executor.all(`SELECT payload FROM _nexus_events WHERE row_id = ? AND entity = 'task' ORDER BY millis LIMIT 1`, ["r1"])[0].payload)
    tA.publish(r1create)
    tA.publish(r1create)
    await new Promise((r) => setTimeout(r, 1200))
    results.idempotent = B.executor.all(`SELECT COUNT(*) AS n FROM task WHERE id = ?`, ["r1"])[0].n === 1

    // ZSYNC-05 — SECURITY: a tampered event on the wire is rejected (gate 1/2)
    const forged = { ...r1create, data: { ...r1create.data, title: "HIJACKED" } } // same id+sig, mutated content
    tA.publish(forged) // content address / signature no longer matches → must not apply
    await new Promise((r) => setTimeout(r, 1500))
    results.tamper_rejected = rowOf(B, "r1")?.title === "from A" // unchanged, forgery ignored

    tA.close()
    tB.close()
} catch (error) {
    results.error = error.message
} finally {
    try { relay?.kill("SIGKILL") } catch {}
    rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    process.stdout.write(JSON.stringify(results) + "\n")
    process.exit(0) // ZEN handles are intentionally long-lived; end the process
}
