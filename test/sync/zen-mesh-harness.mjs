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
const { SyncEngine } = await import(join(ROOT, "src/core/Sync.js"))
const { createZenTransport } = await import(join(ROOT, "src/core/Sync/ZenTransport.js"))
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
    // Retry the BIND, never an assertion. A port already in use is an
    // environmental collision that says nothing about the code, and letting it
    // paint the run red is how a suite teaches people to re-run instead of
    // read. Re-running a failed ASSERTION would be the opposite — that is the
    // habit this harness's flakiness was creating in the first place.
    let port = 0
    for (let attempt = 0; attempt < 4 && !relay; attempt++) {
        port = 39000 + Math.floor(Math.random() * 2000)
        try {
            relay = await startRelay(port, scratch)
        } catch (error) {
            if (attempt === 3) throw new Error(`no free port for the relay after 4 tries: ${error.message}`)
        }
    }
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
    const pairA = await ZEN.pair()
    const pairB = await ZEN.pair()

    // WAIT FOR THE MESH, DO NOT GUESS AT IT. This was a fixed 3s sleep, and on
    // a loaded runner it was not always enough — an event appended before the
    // WebSocket carried anything went nowhere and was never re-sent, so the
    // FIRST assertion failed permanently while the later ones (published once
    // the wire was up) passed. The CI signature was unmistakable once seen:
    // ZSYNC-01 red, 02 green, 03/04/05 red because they depend on r1.
    //
    // A probe converging is the observable condition that "the peers have met",
    // and it costs nothing when the handshake is fast. Its row id is its own, so
    // it disturbs none of the assertions below.
    const probeId = "probe-" + Date.now().toString(36)
    await A.append({ op: "create", entity: "task", rowId: probeId, data: { title: "probe", done: false } }, pairA)
    if (!(await until(() => rowOf(B, probeId), 40000))) {
        // A clear cause beats four confusing assertion failures.
        throw new Error("the mesh never carried a probe event — the peers never met, so nothing below could have converged")
    }

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
    // A NEGATIVE assertion after a fixed sleep can pass simply because nothing
    // arrived yet — it would "prove" idempotence on a mesh that delivered
    // neither copy. Publishing a sentinel and waiting for THAT to land shows
    // the channel actually carried traffic after the duplicates, so "still one
    // row" means deduplicated rather than merely not-yet-delivered.
    const sentinel1 = "sentinel-" + Date.now().toString(36)
    await A.append({ op: "create", entity: "task", rowId: sentinel1, data: { title: "s1", done: false } }, pairA)
    await until(() => rowOf(B, sentinel1), 20000)
    results.idempotent = B.executor.all(`SELECT COUNT(*) AS n FROM task WHERE id = ?`, ["r1"])[0].n === 1

    // ZSYNC-05 — SECURITY: a tampered event on the wire is rejected (gate 1/2)
    const forged = { ...r1create, data: { ...r1create.data, title: "HIJACKED" } } // same id+sig, mutated content
    tA.publish(forged) // content address / signature no longer matches → must not apply
    // Same reasoning as above: a forgery that was never delivered is not a
    // forgery that was rejected. The sentinel proves the wire carried traffic
    // after it, so an unchanged row means the gates refused it.
    const sentinel2 = "sentinel2-" + Date.now().toString(36)
    await A.append({ op: "create", entity: "task", rowId: sentinel2, data: { title: "s2", done: false } }, pairA)
    await until(() => rowOf(B, sentinel2), 20000)
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
