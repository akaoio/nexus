/**
 * Loads the Permission Engine implementation for conformance testing.
 * Same Phase 0 pattern: stub throws NOT_IMPLEMENTED until
 * src/permission/Permission.js lands; the suite must then turn green
 * without editing any test.
 */

const NOT_IMPLEMENTED = () => {
    throw new Error(
        "NOT_IMPLEMENTED: src/permission/Permission.js does not exist yet (Phase 0 — spec is red by design)"
    )
}

let Permission
try {
    Permission = await import("../../../src/permission/Permission.js")
} catch {
    Permission = new Proxy(
        {},
        {
            get: (_, prop) => {
                if (prop === "then") return undefined
                return NOT_IMPLEMENTED
            }
        }
    )
}

export default Permission
