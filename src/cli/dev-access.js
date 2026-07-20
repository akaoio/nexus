/**
 * Who may call which /_studio route (issue #9 C4). The gate reads this table
 * as its ONLY source of truth (issue #9 final review, item 3) — dev.js's
 * gate itself never names a path; a route that is NOT listed here is
 * admin-only by construction, and a route can be opened only by editing this
 * file. That is deliberate: the alternative (a `&& pathname !== "/_studio/x"`
 * literal inside the gate's entry condition) is a SECOND source of truth that
 * can silently drift from this one — and unlike an admin-only default, a
 * missed exclusion there makes the route fully UNAUTHENTICATED, not merely
 * open-to-any-role.
 *
 * "any" means NO AUTH REQUIRED AT ALL — an anonymous, pre-login caller with
 * no Bearer token gets a 200. It does NOT mean "authenticated, any role
 * accepted" — there is no such tier. No /_studio route claims "any" today:
 * the one that used to (the whoami probe) moved to GET /api/v1/_session in
 * Task 2, since the login UI needs to ask "is auth on?" in BOTH modes, not
 * just dev — every declared or undeclared /_studio route now demands the
 * admin role once auth is required. The tier stays defined for a future
 * route that genuinely needs it.
 *
 * "modes" has NO DEFAULT: an entry that omits it is dev-only. Opening a
 * route to production is one deliberate line here, and the invariant
 * clause asserts production answers exactly the declared set (issue #10).
 */

export const STUDIO_ACCESS = Object.freeze({
    // whoami moved to GET /api/v1/_session (Task 2) — one login contract in
    // both modes; the /_studio address is simply gone, not merely re-tiered.
    "/_studio/model": Object.freeze({ roles: "admin", modes: ["dev"] }),
    "/_studio/entities": Object.freeze({ roles: "admin", modes: ["dev"] }),
    "/_studio/entity-delete": Object.freeze({ roles: "admin", modes: ["dev"] }),
    "/_studio/policies": Object.freeze({ roles: "admin", modes: ["dev"] }), // baseline read moves in Task 3
    "/_studio/users": Object.freeze({ roles: "admin", modes: ["dev"] }),
    "/_studio/ai": Object.freeze({ roles: "admin", modes: ["dev"] }),
    "/_studio/config": Object.freeze({ roles: "admin", modes: ["dev"] })
})

/** The declared route list, for the invariant clause. */
export const STUDIO_ROUTE_PATHS = Object.freeze(Object.keys(STUDIO_ACCESS))

/** Required role for a path — undeclared means admin. */
export const accessFor = (pathname) => STUDIO_ACCESS[pathname]?.roles ?? "admin"

/** Declared modes for a path — undeclared means dev-only (no permissive fallback). */
export const modesFor = (pathname) => STUDIO_ACCESS[pathname]?.modes ?? ["dev"]

/** The routes the table opens to production, derived — not hand-maintained. */
export const PRODUCTION_ROUTES = Object.freeze(STUDIO_ROUTE_PATHS.filter((p) => modesFor(p).includes("production")))

export default { STUDIO_ACCESS, STUDIO_ROUTE_PATHS, accessFor, modesFor, PRODUCTION_ROUTES }
