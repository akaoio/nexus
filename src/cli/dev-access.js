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
 * no Bearer token gets a 200 (STUDIO-09a: the login UI must be able to ask
 * "is auth on?" before it holds any token). It does NOT mean "authenticated,
 * any role accepted" — there is no such tier today; every other declared or
 * undeclared route demands the admin role once auth is required.
 */

export const STUDIO_ACCESS = Object.freeze({
    "/_studio/session": "any",     // whoami — no auth required, anonymous included (STUDIO-09a)
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
