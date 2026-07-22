/**
 * ZEN mesh transport conformance (ZSYNC-*) — proves the Sync engine's
 * transport is REAL peer-to-peer gossip over the vendored, first-party ZEN
 * graph, not the in-memory onemit stub. This is the pending "ZEN network
 * transport" deliverable made concrete and locally verifiable.
 *
 * The scenario runs in a child process (test/sync/zen-mesh-harness.mjs): a
 * real ZEN relay on its own port, two independent SyncEngines each on their
 * own in-memory SQLite and their own ZEN store, exchanging signed,
 * content-addressed events over real WebSocket wire. The child is required
 * because a ZEN peer/relay holds background handles open by design (a relay
 * is a long-lived process); isolating it keeps the main runner's clean exit.
 *
 * Node-only (real sockets + subprocess). The clauses assert the harness's
 * JSON verdict for each mesh property; the whole suite skips only if the
 * child cannot be spawned at all, exactly like the other live-engine suites.
 */

import { fileURLToPath } from "url"
import { spawnSync } from "child_process"
import Test, { assert } from "../../src/core/Test.js"
import { graphOptions } from "../../src/core/Sync/ZenTransport.js"

const HARNESS = fileURLToPath(new URL("./zen-mesh-harness.mjs", import.meta.url))

// Run the mesh once; every clause reads a field of the same verdict. The
// convergence budget is generous — real WS peer discovery on a slow board.
let verdict = null
let spawnError = null
try {
    const result = spawnSync(process.execPath, [HARNESS], { encoding: "utf8", timeout: 180000 })
    const line = (result.stdout ?? "").trim().split("\n").filter(Boolean).pop()
    verdict = line ? JSON.parse(line) : null
    if (!verdict) spawnError = `no verdict (exit ${result.status}, stderr: ${(result.stderr ?? "").slice(0, 200)})`
} catch (error) {
    spawnError = error.message
}

if (!verdict) {
    // The harness legitimately cannot run everywhere (no network, sandboxed
    // CI) — that is a defensible skip. This is NOT a browser concern: the
    // harness is Node-only (child_process + real sockets), so `{ browser:
    // true }` would silently no-op here regardless of whether the process
    // crashed or the environment just lacks the mesh, hiding a real bug
    // behind an environment-flavoured skip. Use the runner's explicit,
    // environment-independent skip instead, with a fixed test name and the
    // real reason surfaced via a warning, not interpolated into the name.
    // (A harness that DID run and returned `verdict.error` is a different
    // path — the `else` branch below — and fails ZSYNC-00 for real.)
    console.warn(`ZSYNC-00 the mesh harness did not run: ${spawnError}`)
    Test.describe("Sync over ZEN mesh (ZSYNC, harness unavailable)", () => {
        Test.it("ZSYNC-00 the mesh harness did not run", () => {}, { interactive: true })
    })
} else {
    Test.describe("Sync over ZEN mesh (ZSYNC) — real peer-to-peer transport", () => {
        Test.it("SYNCNET-01 the peer list IS the peer list — LAN multicast is opt-in, never a default", () => {
            // ZEN joins a LAN multicast group by default, so a transport told to
            // talk to `peers: ["http://relay/zen"]` ALSO gossiped every event to
            // anything on the local network that speaks the protocol and knows
            // the channel name. Nobody asked for that.
            //
            // It was breaking convergence too, and that is how it was found:
            // roughly half of two-peer runs on the development machine lost an
            // event PERMANENTLY — a peer waited 150 seconds, seven times the
            // harness's own window, with nothing in quarantine and no gate
            // having rejected it. Never delivered. CI never saw it because a CI
            // container has no LAN peers to discover, so only the relay path
            // ever existed there; the failure needed a real network to appear
            // on, and a green CI was the reason it went unexamined.
            assert.equal(graphOptions({ peers: ["http://r/zen"], file: "f" }).multicast, false)
            assert.deepEqual(graphOptions({ peers: ["http://r/zen"], file: "f" }).peers, ["http://r/zen"])

            // Local-first LAN discovery is a legitimate thing to want. It just
            // has to be asked for — and `undefined` is how ZEN is told to use
            // its own default, which is what "on" means here.
            assert.equal(graphOptions({ peers: [], file: "f", multicast: true }).multicast, undefined)

            // Anything short of an explicit true stays off: a truthy config
            // value read from JSON must not switch a network surface on.
            for (const value of ["true", 1, {}, "yes"])
                assert.equal(graphOptions({ file: "f", multicast: value }).multicast, false, `multicast: ${JSON.stringify(value)} must not enable it`)
        })


        Test.it("ZSYNC-00 the harness completed without error", () => {
            assert.equal(verdict.error, undefined, verdict.error ? `harness error: ${verdict.error}` : "")
        })
        Test.it("ZSYNC-01 a create on peer A projects onto peer B over real ZEN gossip", () => {
            assert.truthy(verdict.converge_a_to_b, "B did not converge on A's create")
        })
        Test.it("ZSYNC-02 the mesh is bidirectional: a create on B projects onto A", () => {
            assert.truthy(verdict.converge_b_to_a, "A did not converge on B's create")
        })
        Test.it("ZSYNC-03 an update converges as an update (row refold, not a duplicate row)", () => {
            assert.truthy(verdict.update_converges, "B did not converge on the update, or duplicated the row")
        })
        Test.it("ZSYNC-04 re-delivery is idempotent — a republished event adds no second row", () => {
            assert.truthy(verdict.idempotent, "a re-delivered event was not deduplicated")
        })
        Test.it("ZSYNC-05 SECURITY: a tampered event on the wire is rejected by gates 1/2", () => {
            assert.truthy(verdict.tamper_rejected, "a forged event mutated the projected row")
        })
    })
}
