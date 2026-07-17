/**
 * Loads the Query AST implementation for conformance testing.
 *
 * Phase 0 (TDD): src/core/AST.js does not exist yet. Instead of crashing the
 * runner on a failed static import, every API surface resolves to a stub that
 * throws NOT_IMPLEMENTED — so every conformance clause registers, runs, and
 * fails red with a clear reason. When the implementation lands (Phase 2),
 * this loader returns the real module and the suite must turn green without
 * editing a single test.
 */

const NOT_IMPLEMENTED = () => {
    throw new Error("NOT_IMPLEMENTED: src/core/AST.js does not exist yet (Phase 0 — spec is red by design)")
}

let AST
try {
    AST = await import("../../../src/core/AST.js")
} catch {
    AST = new Proxy(
        {},
        {
            get: (_, prop) => {
                if (prop === "then") return undefined // not a thenable
                return NOT_IMPLEMENTED
            }
        }
    )
}

export default AST
