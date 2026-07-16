/**
 * <nx-search> — global search across every readable entity (§7/§4.6).
 * Transport-agnostic like the other Studio components: `.searcher` is an
 * injected async ({ entity, query }) → [{score, row}] — the host wires it
 * to POST /api/v1/:entity/search or straight to DataPlane.search.
 */

import { Component } from "../kernel/UI/Component.js"
import { html, render } from "../kernel/UI.js"
import { css } from "../kernel/UI/css.js"

const STYLE = () => css`
    :host { font-family: system-ui; font-size: 14px; display: block }
    input.query { font: inherit; padding: 4px 8px; border: 1px solid #94a3b8; border-radius: 6px; background: transparent; color: inherit; width: 100% }
    .entity-head { font-weight: 600; margin: 8px 0 2px; color: #0ea5e9 }
    .hit { display: flex; gap: 8px; margin: 2px 0 }
    .score { color: #64748b; font-variant-numeric: tabular-nums; min-width: 4em }
    .muted { color: #64748b; font-style: italic }
`

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
        render(html`
            ${STYLE()}
            <input class="query" placeholder="search everything…" ${({ element }) => {
                this.$query = element
                this.listen(element, "input", () => {
                    clearTimeout(this.#timer)
                    this.#timer = setTimeout(() => this.run(), 250)
                })
            }}>
            <div class="results" ${({ element }) => (this.$results = element)}></div>
        `, this.shadowRoot)
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
            head.textContent = `${schema.name} (${hits.length})`
            this.$results.appendChild(head)
            for (const { score, row } of hits) {
                const line = document.createElement("div")
                line.className = "hit"
                const scoreEl = document.createElement("span")
                scoreEl.className = "score"
                scoreEl.textContent = score.toFixed(3)
                line.appendChild(scoreEl)
                const label = document.createElement("span")
                const firstText = (schema.fields ?? []).find((f) => f.type === "text")
                label.textContent = String(row[firstText?.name] ?? row.id)
                line.appendChild(label)
                this.$results.appendChild(line)
            }
        }
        if (!this.$results.childNodes.length) {
            const empty = document.createElement("div")
            empty.className = "muted"
            empty.textContent = "no matches"
            this.$results.appendChild(empty)
        }
    }
}

if (typeof customElements !== "undefined") customElements.define("nx-search", NxSearch)
