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

export class NxSearch extends Component {
    #schemas = []
    #timer = null

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
            }
        }), this.shadowRoot)
    }

    async run() {
        const query = this.$query.value.trim()
        this.$results.replaceChildren()
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
        if (!this.$results.childNodes.length) {
            const empty = document.createElement("div")
            empty.className = "muted"
            empty.textContent = `No matches for “${query}” — semantic search tries meaning too, so a synonym may land.`
            this.$results.appendChild(empty)
        }
    }
}

if (typeof customElements !== "undefined") customElements.define("nx-search", NxSearch)
