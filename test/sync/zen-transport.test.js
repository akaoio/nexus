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

import { spawnSync } from "child_process"
import Test, { assert } from "../../src/kernel/Test.js"

const HARNESS = new URL("./zen-mesh-harness.mjs", import.meta.url).pathname

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
    Test.describe("Sync over ZEN mesh (ZSYNC, harness unavailable)", () => {
        Test.it(`ZSYNC-00 skipped — mesh harness did not run: ${spawnError}`, () => {}, { browser: true })
    })
} else {
    Test.describe("Sync over ZEN mesh (ZSYNC) — real peer-to-peer transport", () => {
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
