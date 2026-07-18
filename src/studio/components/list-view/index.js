/**
 * <nx-list-view> — schema-aware rows with sort, group-by and CSV export
 * (ARCHITECTURE.md §7). Transport-agnostic: `.rows` is data in, the host
 * wires it to the Data Plane or HTTP. Saved views are deferred to the app
 * system's storage story — deferred loudly, not forgotten.
 *
 * Sorting follows the framework's ordering semantics (AST-O05/O17): strict
 * types, strings by code unit, nulls always LAST regardless of direction.
 *
 * akao triad: logic here, template in template.js, styles in styles.css.js.
 */

import { Component } from "../../../core/UI/Component.js"
import { render } from "../../../core/UI.js"
import { listTemplate } from "./template.js"
// the pure list mechanics live with the saved-view logic in the kernel —
// one definition serves the component, the views module, and the tests
import { sortRows, groupRows } from "../../../core/Views.js"

const clone = (x) => JSON.parse(JSON.stringify(x))

/** RFC-4180-style CSV: quote when needed, double embedded quotes. */
export function toCSV(rows, columns) {
    const cell = (value) => {
        if (value === null || value === undefined) return ""
        const text = String(value)
        return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
    }
    const lines = [columns.map(cell).join(",")]
    for (const row of rows) lines.push(columns.map((c) => cell(row?.[c])).join(","))
    return lines.join("\n")
}

/** The visible column list for a schema: id + non-table fields + owner. */
export const columnsFor = (schema) => [
    "id",
    ...(schema?.fields ?? []).filter((f) => f.type !== "table").map((f) => f.name),
    "owner"
]

// ─── <nx-list-view> ───────────────────────────────────────────────────────────

export class NxListView extends Component {
    #schema = null
    #rows = []
    #sort = null // { field, dir }
    #groupBy = ""

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
    }

    set schema(schema) {
        this.#schema = schema
        if (this.isConnected) this.mount()
    }

    get schema() {
        return this.#schema
    }

    set rows(rows) {
        this.#rows = clone(rows ?? [])
        if (this.isConnected) this.mount()
    }

    get rows() {
        return clone(this.#rows)
    }

    /** The rows exactly as displayed (sorted). Groups flatten in order. */
    get displayed() {
        let rows = this.#rows
        if (this.#sort) rows = sortRows(rows, this.#sort.field, this.#sort.dir)
        if (!this.#groupBy) return clone(rows)
        const out = []
        for (const [, groupRows_] of groupRows(rows, this.#groupBy)) out.push(...groupRows_)
        return clone(out)
    }

    /** CSV of the current view. */
    get csv() {
        return toCSV(this.displayed, columnsFor(this.#schema))
    }

    onconnect() {
        this.mount()
    }

    mount() {
        const columns = columnsFor(this.#schema)
        render(listTemplate(this, {
            columns,
            groupBy: this.#groupBy,
            count: this.#rows.length,
            onGroupBy: (value) => {
                this.#groupBy = value
                this.mount()
            },
            onExport: () => {
                const blob = new Blob([this.csv], { type: "text/csv" })
                const a = document.createElement("a")
                a.href = URL.createObjectURL(blob)
                a.download = `${this.#schema?.name ?? "rows"}.csv`
                a.click()
                URL.revokeObjectURL(a.href)
            }
        }), this.shadowRoot)

        for (const column of columns) {
            const th = document.createElement("th")
            th.dataset.column = column
            const marker = this.#sort?.field === column ? (this.#sort.dir === "asc" ? " ↑" : " ↓") : ""
            th.textContent = column + marker
            this.listen(th, "click", () => {
                this.#sort =
                    this.#sort?.field === column && this.#sort.dir === "asc"
                        ? { field: column, dir: "desc" }
                        : { field: column, dir: "asc" }
                this.mount()
            })
            this.$head.appendChild(th)
        }

        const renderRow = (row) => {
            const tr = document.createElement("tr")
            for (const column of columns) {
                const td = document.createElement("td")
                const value = row?.[column]
                td.textContent = value === null || value === undefined ? "" : String(value)
                tr.appendChild(td)
            }
            this.$body.appendChild(tr)
        }

        let rows = this.#rows
        if (this.#sort) rows = sortRows(rows, this.#sort.field, this.#sort.dir)
        if (this.#groupBy) {
            for (const [label, group] of groupRows(rows, this.#groupBy)) {
                const head = document.createElement("tr")
                head.className = "group-head"
                const td = document.createElement("td")
                td.colSpan = columns.length
                td.textContent = `${this.#groupBy}: ${label} (${group.length})`
                head.appendChild(td)
                this.$body.appendChild(head)
                for (const row of group) renderRow(row)
            }
        } else for (const row of rows) renderRow(row)
    }
}

if (typeof customElements !== "undefined") customElements.define("nx-list-view", NxListView)
