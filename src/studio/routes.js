/**
 * The Studio's route table — declared ONCE so every server that has to decide
 * "does this path get the Studio shell" reads the SAME list, rather than each
 * carrying its own copy that can quietly drift out of sync:
 *
 *   - `nexus dev` (src/cli/commands/dev.js) — the LIVE Studio, served through
 *     /_nexus/*.
 *   - `nexus start` (src/cli/commands/start.js) — the BUILT Studio (Task 5/6),
 *     served as a static shell + assets under public/studio/.
 *
 * Mirrors src/studio/app.js's own ROUTES/MODULES/settings.FEATURES — that is
 * the client router's source of truth; this is its server-side counterpart.
 */

import { Router } from "../core/Router.js"

export const STUDIO_ROUTES = ["/entity/[entity]", "/settings/[feature]", "/[view]"]
export const STUDIO_VIEWS = new Set(["entities", "entity", "permissions", "roles", "users", "jobs", "settings", "search"]) // "entity" = legacy redirect
export const STUDIO_SETTINGS = new Set(["ai", "locales", "themes"])

/**
 * Does `pathname` resolve to a known Studio page? A path only reaches the
 * shell if it precisely matches one of STUDIO_ROUTES with a KNOWN value (a
 * real entity name, a real settings feature, a real view) — a file-looking
 * path (has an extension) or a dotpath NEVER does. That is what keeps a
 * static asset request (or a dotfile probe) from ever getting routed to the
 * SPA shell instead of 404ing/being served as an asset.
 *
 * `locales` is optional: Router.process() already falls back to a generic
 * two-letter-code regex for locale-prefix stripping even with an empty list
 * (see core/Router.js), so a caller that has not loaded the instance's i18n
 * dictionary (nexus start has no reason to) still strips a locale prefix
 * correctly for ordinary locale codes.
 */
export function studioRouteMatches(pathname, { schemas = [], locales = [] } = {}) {
    if (/\.[^/]+$/.test(pathname) || pathname.includes("/.")) return false // files + dotpaths are never routes
    const localeObjs = locales.map((code) => ({ code }))
    const r = Router.process({ path: pathname, routes: STUDIO_ROUTES, locales: localeObjs })
    // "home" covers both the root and unmatched leftovers — tell them apart
    const segments = pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean)
    if (segments.length && (locales.includes(segments[0]) || /^[a-z]{2}(-[A-Z]{2})?$/.test(segments[0]))) segments.shift()
    if (!segments.length) return true // "/" or a bare locale prefix
    if (r.route === "/entity/[entity]") return schemas.some((s) => s.name === r.params.entity)
    if (r.route === "/settings/[feature]") return STUDIO_SETTINGS.has(r.params.feature)
    if (r.route === "/[view]") return STUDIO_VIEWS.has(r.params.view)
    return false
}

export default { STUDIO_ROUTES, STUDIO_VIEWS, STUDIO_SETTINGS, studioRouteMatches }
