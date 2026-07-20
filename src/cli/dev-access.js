/**
 * Who may call which /_studio route (issue #9 C4). The gate reads this table;
 * a route that is NOT listed is admin-only. Fail-closed by construction: a new
 * route ships strict unless someone deliberately opens it in this file.
 */

export const STUDIO_ACCESS = Object.freeze({
    "/_studio/session": "any",     // whoami — the login UI needs it before roles exist
    "/_studio/model": "admin",
    "/_studio/entities": "admin",
    "/_studio/entity-delete": "admin",
    "/_studio/policies": "admin",
    "/_studio/users": "admin",
    "/_studio/ai": "admin",
    "/_studio/config": "admin"
})

/** The declared route list, for the invariant clause. */
export const STUDIO_ROUTE_PATHS = Object.freeze(Object.keys(STUDIO_ACCESS))

/** Required role for a path — undeclared means admin. */
export const accessFor = (pathname) => STUDIO_ACCESS[pathname] ?? "admin"

export default { STUDIO_ACCESS, STUDIO_ROUTE_PATHS, accessFor }
