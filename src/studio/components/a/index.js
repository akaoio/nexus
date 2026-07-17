/**
 * <a is="nx-a"> — the akao `a` primitive: a REAL anchor that PRE-CACHES what
 * it points to. The moment the link appears in the UI, the route's data is
 * fetched and remembered in IndexedDB (once per target per session), so the
 * click lands on an instantly-painted, offline-capable screen. Navigation
 * itself is the platform's: hash hrefs need no click interception.
 *
 * Customized built-in (extends HTMLAnchorElement), exactly like akao's
 * `customElements.define("ui-a", A, { extends: "a" })`.
 */

import { cached, remember } from "../../app/cache.js"

const warmed = new Set()

export class NxA extends HTMLAnchorElement {
    /** The app wires the fetcher once: async (entity) => rows|null. */
    static fetchRows = null

    connectedCallback() {
        this.#precache()
    }

    async #precache() {
        const match = /^#\/entity\/([a-z][a-z0-9_]*)$/.exec(this.getAttribute("href") ?? "")
        if (!match || !NxA.fetchRows || warmed.has(match[1])) return
        warmed.add(match[1])
        try {
            const rows = await NxA.fetchRows(match[1])
            if (rows) await remember("rows:" + match[1], rows)
        } catch {
            warmed.delete(match[1]) // offline now — retry on the next mount
        }
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-a")) customElements.define("nx-a", NxA, { extends: "a" })

export { cached }
export default NxA
