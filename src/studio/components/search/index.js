/**
 * <nx-search> — global search across every readable entity (§7/§4.6).
 * Transport-agnostic like the other Studio components: `.searcher` is an
 * injected async ({ entity, query }) → [{score, row}] — the host wires it
 * to POST /api/v1/:entity/search or straight to DataPlane.search.
 *
 * akao triad: logic here, template in template.js, styles in styles.css.js.
 */

import { Component } from "../../../core/UI/Component.js"
import { render } from "../../../core/UI.js"
import { searchTemplate } from "./template.js"

/**
 * Where the selection moves for a navigation key. Pure, so it is asserted
 * under Node rather than left to a browser-only clause nobody runs
 * (NXSR-KEY-01).
 *
 * Three choices worth stating:
 *  - It WRAPS at both ends. A results list is a cycle; stopping dead at the
 *    last item reads as broken rather than as a boundary.
 *  - Nothing selected (-1) + ArrowUp selects the LAST item — the "open
 *    upward" behaviour of every command palette.
 *  - An empty list stays at -1, so Enter does nothing instead of opening a
 *    hit that is not there.
 *
 * @param {number} current - selected index, or -1 for none
 * @param {number} count - number of hits
 * @param {string} key - KeyboardEvent.key
 * @returns {number} the next index, or -1 for none
 */
export function nextIndex(current, count, key) {
    if (!count) return -1
    switch (key) {
        case "ArrowDown": return current < 0 ? 0 : (current + 1) % count
        case "ArrowUp": return current < 0 ? count - 1 : (current - 1 + count) % count
        case "Home": return 0
        case "End": return count - 1
        default: return current
    }
}

export class NxSearch extends Component {
    #schemas = []
    #timer = null
    #hits = [] // the selectable result elements, in visual order
    #selected = -1

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        this.searcher = null // async ({ entity, query }) → [{score, row}]
    }

    set schemas(schemas) {
        this.#schemas = schemas ?? []
        if (this.isConnected) this.mount()
    }

    get schemas() {
        return this.#schemas
    }

    onconnect() {
        this.mount()
    }

    mount() {
        render(searchTemplate(this, {
            onInput: () => {
                clearTimeout(this.#timer)
                this.#timer = setTimeout(() => this.run(), 250)
            },
            onKeydown: (event) => this.#onKeydown(event)
        }), this.shadowRoot)
    }

    #onKeydown(event) {
        if (event.key === "Escape") {
            this.$query.value = ""
            this.#paint(-1)
            this.$results.replaceChildren()
            this.#hits = []
            return
        }
        if (event.key === "Enter") {
            const hit = this.#hits[this.#selected]
            if (!hit) return // nothing selected, or nothing to select
            event.preventDefault()
            // Transport-agnostic, like `.searcher`: the component says WHICH
            // record was chosen; the host decides what opening it means.
            this.dispatchEvent(new CustomEvent("nx-open", {
                bubbles: true,
                composed: true,
                detail: { entity: hit.dataset.entity, id: hit.dataset.id }
            }))
            return
        }
        const next = nextIndex(this.#selected, this.#hits.length, event.key)
        if (next === this.#selected) return
        event.preventDefault()
        this.#paint(next)
    }

    /** Move the selection, and tell assistive technology it moved. */
    #paint(index) {
        this.#selected = index
        this.#hits.forEach((hit, i) => {
            const on = i === index
            hit.classList.toggle("selected", on)
            hit.setAttribute("aria-selected", String(on))
        })
        const active = this.#hits[index]
        if (active) {
            this.$query.setAttribute("aria-activedescendant", active.id)
            active.scrollIntoView?.({ block: "nearest" })
        } else {
            this.$query.removeAttribute("aria-activedescendant")
        }
    }

    async run() {
        const query = this.$query.value.trim()
        this.$results.replaceChildren()
        this.#hits = []
        this.#selected = -1
        this.$query.removeAttribute("aria-activedescendant")
        this.$query.setAttribute("aria-expanded", "false")
        if (!query || !this.searcher) return
        for (const schema of this.#schemas) {
            const hits = await this.searcher({ entity: schema.name, query })
            if (!hits?.length) continue
            const head = document.createElement("div")
            head.className = "entity-head"
            head.textContent = `${schema.name} · ${hits.length}`
            this.$results.appendChild(head)
            for (const { score, row } of hits) {
                const line = document.createElement("div")
                line.className = "hit"
                line.id = `nx-hit-${schema.name}-${row.id}`
                line.setAttribute("role", "option")
                line.setAttribute("aria-selected", "false")
                line.dataset.entity = schema.name
                line.dataset.id = row.id
                this.#hits.push(line)
                const label = document.createElement("span")
                label.className = "label"
                const firstText = (schema.fields ?? []).find((f) => f.type === "text")
                label.textContent = String(row[firstText?.name] ?? row.id)
                const scoreEl = document.createElement("span")
                scoreEl.className = "score"
                scoreEl.textContent = score.toFixed(3)
                line.append(label, scoreEl)
                this.$results.appendChild(line)
            }
        }
        this.$query.setAttribute("aria-expanded", String(this.#hits.length > 0))
        // Preselect the first hit so Enter works without an arrow press first.
        if (this.#hits.length) this.#paint(0)
        if (!this.$results.childNodes.length) {
            const empty = document.createElement("div")
            empty.className = "muted"
            empty.textContent = `No matches for “${query}” — semantic search tries meaning too, so a synonym may land.`
            this.$results.appendChild(empty)
        }
    }
}

if (typeof customElements !== "undefined") customElements.define("nx-search", NxSearch)
