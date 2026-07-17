/**
 * <a is="nx-a"> — the akao `a` primitive, complete: a REAL anchor whose href
 * is the LOCALIZED route path (/vi/entity/task), whose click drives pushState
 * navigation (no page reload), and which PRE-CACHES what it points to the
 * moment it appears in the UI — the click lands on an instantly-painted,
 * offline-capable screen. `customElements.define(…, { extends: "a" })`,
 * exactly like akao's ui-a.
 *
 * The app wires three statics once:
 *   NxA.hrefFor  = (to) => localized path      (kernel Router)
 *   NxA.go       = (to) => pushState + render
 *   NxA.fetchRows = async (entity) => rows     (pre-cache source)
 */

import { remember } from "../../app/cache.js"

const warmed = new Set()

export class NxA extends HTMLAnchorElement {
    static hrefFor = null
    static go = null
    static fetchRows = null

    static observedAttributes = ["data-to"]

    connectedCallback() {
        this.addEventListener("click", this.#click)
        this.paint()
        this.#precache()
    }

    disconnectedCallback() {
        this.removeEventListener("click", this.#click)
    }

    attributeChangedCallback() {
        this.paint()
        this.#precache()
    }

    #click = (event) => {
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return // new-tab gestures stay native
        event.preventDefault()
        NxA.go?.(this.dataset.to ?? this.getAttribute("href"))
    }

    paint() {
        const to = this.dataset.to
        if (!to) return
        const href = NxA.hrefFor?.(to) ?? to
        if (this.getAttribute("href") !== href) this.setAttribute("href", href)
    }

    async #precache() {
        const match = /^\/entity\/([a-z][a-z0-9_]*)$/.exec(this.dataset.to ?? "")
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

export default NxA
