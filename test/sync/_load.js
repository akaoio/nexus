/**
 * Loads the Sync engine for conformance testing — the Phase 0 stub pattern:
 * when src/core/Sync.js is ABSENT, every surface throws NOT_IMPLEMENTED so
 * the SYNC-* suite runs RED (docs/sync-design.md §11: no sync code before
 * these clauses exist red). When the implementation lands, the suite must
 * turn green without editing a single test.
 *
 * The stub stands in ONLY for an absent module. If src/core/Sync.js is
 * PRESENT but its import fails (syntax error, bad top-level import, a
 * thrown init), that error must propagate unswallowed — never masked as
 * "not yet implemented" (issue #9 H2). loadSync(url, exists) makes that
 * present-vs-absent rule directly testable (SYNCLOAD-01).
 */

import { existsSync } from "fs"
import { fileURLToPath } from "url"

const NOT_IMPLEMENTED = () => {
    throw new Error("NOT_IMPLEMENTED: src/core/Sync.js does not exist yet (SYNC spec is red by design)")
}

/** Present → real import, error propagates. Absent → the NOT_IMPLEMENTED stub. */
export async function loadSync(url, exists) {
    if (!exists) return new Proxy({}, { get: (_, prop) => (prop === "then" ? undefined : NOT_IMPLEMENTED) })
    return await import(url)
}

const SYNC_URL = new URL("../../src/core/Sync.js", import.meta.url)
const Sync = await loadSync(SYNC_URL.href, existsSync(fileURLToPath(SYNC_URL)))

export default Sync
