/**
 * Loads the Model Schema implementation for conformance testing.
 * Same Phase 0 pattern as the AST loader: until src/core/Model.js exists,
 * every API resolves to a stub that throws NOT_IMPLEMENTED, keeping the
 * suite red-not-crashed. When the implementation lands, this returns the
 * real module and the suite must turn green without editing any test.
 */

const NOT_IMPLEMENTED = () => {
    throw new Error("NOT_IMPLEMENTED: src/core/Model.js does not exist yet (Phase 0 — spec is red by design)")
}

let Model
try {
    Model = await import("../../../src/core/Model.js")
} catch {
    Model = new Proxy(
        {},
        {
            get: (_, prop) => {
                if (prop === "then") return undefined
                return NOT_IMPLEMENTED
            }
        }
    )
}

export default Model
