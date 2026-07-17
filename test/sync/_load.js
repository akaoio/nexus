/**
 * Loads the Sync engine for conformance testing — the Phase 0 stub pattern:
 * until src/core/Sync.js exists, every surface throws NOT_IMPLEMENTED so
 * the SYNC-* suite runs RED (docs/sync-design.md §11: no sync code before
 * these clauses exist red). When the implementation lands, the suite must
 * turn green without editing a single test.
 */

const NOT_IMPLEMENTED = () => {
    throw new Error("NOT_IMPLEMENTED: src/core/Sync.js does not exist yet (SYNC spec is red by design)")
}

let Sync
try {
    Sync = await import("../../src/core/Sync.js")
} catch {
    Sync = new Proxy({}, { get: (_, prop) => (prop === "then" ? undefined : NOT_IMPLEMENTED) })
}

export default Sync
