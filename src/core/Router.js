/**
 * Pattern-based router — the pure routing core extracted from akao
 * src/core/Router.js.
 *
 * Kernel scope: process() and match() only, fully parameter-driven — no
 * hidden reads from a global Statics store. akao's setHead/setLocale/
 * navigate/setHistory were coupled to its Statics/DB/Context and stay
 * app-side (N5); a future kernel navigation layer will be designed against
 * the Data Plane, not extracted as-is.
 *
 * Route patterns:
 *   /item/[param]        dynamic segment
 *   /docs/[...path]      catch-all (requires ≥1 segment, must be last)
 *   /docs/[[...path]]    optional catch-all (may be empty, must be last)
 */

export class Router {
    /**
     * Process a URL path into { locale, params, route, path }.
     *
     * Locale is resolved from: explicit `locale` arg → path prefix →
     * localStorage ("locale") → site.locale → first entry of `locales`.
     * Search params merge into params (path params take precedence).
     *
     * @param {Object} options
     * @param {string} options.path - URL path (defaults to current location in the browser)
     * @param {Array} options.routes - Route patterns (strings or { path })
     * @param {Array} options.locales - Supported locales [{ code, ... }]
     * @param {Object} options.site - Site config ({ locale } used as fallback)
     * @param {string} [options.locale] - Explicit locale code override
     * @returns {{locale: Object|undefined, params: Object, route: string, path: string}}
     */
    static process({ path = "", routes = [], locales = [], site = {}, locale } = {}) {
        path = path || (globalThis?.location?.pathname || "") + (globalThis?.location?.search || "")
        // Extract search query string before path processing
        const query = path.indexOf("?")
        const search = query !== -1 ? path.slice(query) : ""
        if (query !== -1) path = path.slice(0, query)
        // Remove leading/trailing slashes and a trailing file segment (e.g. index.html)
        let segments = path
            .replace(/^\/+|\/+$|\/\w+\.\w+$/g, "")
            .split("/")
            .filter(Boolean)
        let code = locale || globalThis?.localStorage?.getItem?.("locale") || site?.locale || locales?.[0]?.code
        const result = {
            locale: locales.find((l) => l.code === code),
            params: {},
            route: "home"
        }
        if (segments.length) {
            // Check if first part is a supported locale or matches locale pattern
            if (locales.some((l) => l.code === segments?.[0]) || /^[a-z]{2}(-[A-Z]{2})?$/.test(segments[0])) {
                code = segments.shift()
                if (!locale) result.locale = locales.find((l) => l.code === code)
            }
            // Check against known route patterns
            for (const route of routes) {
                const params = this.match(segments, route)
                if (params) {
                    result.params = params
                    result.route = route
                    break
                }
            }
        }
        // Merge search params into params (path params take precedence)
        if (search)
            for (const [key, value] of new URLSearchParams(search))
                if (!(key in result.params)) result.params[key] = value

        // Create new path including locale (omitted when no locale is known)
        result.path = `/${[result.locale?.code, ...segments].filter(Boolean).join("/")}/`
        return result
    }

    /**
     * Match URL segments against a route pattern and extract parameters.
     * @param {Array<string>} segments - URL path segments to match
     * @param {string|Object} route - Route pattern string or object with path property
     * @returns {Object|null} Extracted parameters, or null if no match
     */
    static match(segments, route) {
        const pattern = typeof route === "string" ? route : route?.path
        if (!pattern) return null
        const parts = pattern.replace(/^\/+|\/+$/g, "").split("/")

        const params = {}
        let si = 0 // segment index

        for (let pi = 0; pi < parts.length; pi++) {
            const part = parts[pi]
            const isCatchAll = part.startsWith("[...") && part.endsWith("]") && !part.startsWith("[[")
            const isOptionalCatchAll = part.startsWith("[[...") && part.endsWith("]]")

            if (isCatchAll || isOptionalCatchAll) {
                const nameMatch = part.match(/\[\[?\.\.\.(.+?)\]\]?/)
                const name = nameMatch?.[1]
                if (!name) return null
                const rest = segments.slice(si)
                if (!isOptionalCatchAll && rest.length === 0) return null // required catch-all needs ≥1 segment
                params[name] = rest
                si = segments.length
                // catch-all must be the last pattern part; otherwise ambiguous
                if (pi !== parts.length - 1) return null
                break
            }

            if (si >= segments.length) return null // no segment left to match

            if (part.startsWith("[") && part.endsWith("]")) {
                params[part.slice(1, -1)] = segments[si]
                si += 1
                continue
            }

            if (part !== segments[si]) return null
            si += 1
        }

        // All pattern parts consumed; ensure all segments matched
        if (si !== segments.length) return null
        return params
    }
}

export default Router
