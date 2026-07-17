/**
 * List view — the Frappe-grade table: a tri-state select-all checkbox
 * (none/some/all + invert on "some"), per-row checkboxes, sortable AND
 * drag-reorderable columns (order remembered per entity), type-aware display
 * cells, and a scroll container so a wide table never breaks the page.
 */

import { el, icon } from "../lib.js"
import { editableFields, displays } from "../fields.js"

const rendererFor = (type) => displays[type] || displays.default
const cellClass = (type, column) => {
    if (column === "id") return "mono"
    if (type === "integer" || type === "number") return "num"
    if (type === "datetime" || type === "date") return "mono"
    return ""
}

/** Stable sort, strict types, nulls last. */
function sortBy(rows, field, dir) {
    const factor = dir === "desc" ? -1 : 1
    return [...rows].sort((a, b) => {
        const va = a?.[field]
        const vb = b?.[field]
        const aNull = va === null || va === undefined
        const bNull = vb === null || vb === undefined
        if (aNull && bNull) return 0
        if (aNull) return 1
        if (bNull) return -1
        if (typeof va !== typeof vb) return 0
        return va < vb ? -factor : va > vb ? factor : 0
    })
}

/** Column order per entity, remembered locally (drag a header to move it). */
const colKey = (entity) => `nexus-cols-${entity}`
function orderedColumns(schema) {
    const base = ["id", ...editableFields(schema).map((f) => f.name), "owner", "updated_at"]
    try {
        const saved = JSON.parse(localStorage.getItem(colKey(schema.name)) ?? "null")
        if (Array.isArray(saved)) {
            const known = saved.filter((c) => base.includes(c))
            return [...known, ...base.filter((c) => !known.includes(c))]
        }
    } catch {}
    return base
}

export function render({ schema, rows, selection, onRow }) {
    const cols = orderedColumns(schema)
    const typeOf = {
        owner: "text", created_at: "datetime", updated_at: "datetime",
        ...Object.fromEntries((schema.fields ?? []).map((f) => [f.name, f.type]))
    }
    const ids = rows.map((r) => r.id)
    const sort = { field: null, dir: "asc" }
    let dragFrom = null

    const table = el("table", { class: "nx-table" })
    const head = el("tr")
    const body = el("tbody")

    function paintHead() {
        head.replaceChildren()
        // tri-state master checkbox: none→all, all→none, some→INVERT (Frappe)
        const master = el("input", { type: "checkbox" })
        const sync = () => {
            const state = selection.stateOf(ids)
            master.checked = state === "all"
            master.indeterminate = state === "some"
            master.title = state === "some" ? "Invert selection" : state === "all" ? "Uncheck all" : "Check all"
        }
        master.addEventListener("click", (e) => {
            e.stopPropagation()
            const state = selection.stateOf(ids)
            if (state === "none") selection.all(ids)
            else if (state === "all") selection.invert(ids) // all visible → none
            else selection.invert(ids)
        })
        sync()
        head.append(el("th", { class: "nx-selcol" }, [master]))
        cols.forEach((c, i) => {
            const th = el("th", {
                class: "sortable",
                draggable: true,
                onclick: () => {
                    if (sort.field === c) sort.dir = sort.dir === "asc" ? "desc" : "asc"
                    else { sort.field = c; sort.dir = "asc" }
                    paint()
                }
            }, sort.field === c ? [document.createTextNode(c + " "), icon(sort.dir === "asc" ? "arrow-up" : "arrow-down")] : [document.createTextNode(c)])
            th.addEventListener("dragstart", () => (dragFrom = i))
            th.addEventListener("dragover", (e) => e.preventDefault())
            th.addEventListener("drop", (e) => {
                e.preventDefault()
                if (dragFrom === null || dragFrom === i) return
                const [moved] = cols.splice(dragFrom, 1)
                cols.splice(i, 0, moved)
                localStorage.setItem(colKey(schema.name), JSON.stringify(cols))
                dragFrom = null
                paint()
            })
            head.append(th)
        })
    }

    function paint() {
        paintHead()
        body.replaceChildren()
        const view = sort.field ? sortBy(rows, sort.field, sort.dir) : rows
        for (const row of view) {
            const box = el("input", { type: "checkbox", checked: selection.has(row.id) })
            box.addEventListener("click", (e) => {
                e.stopPropagation()
                selection.toggle(row.id)
            })
            const tr = el("tr", { class: "clickable" + (selection.has(row.id) ? " selected" : ""), onclick: () => onRow(row) })
            tr.append(el("td", { class: "nx-selcol", onclick: (e) => { e.stopPropagation(); selection.toggle(row.id) } }, [box]))
            for (const c of cols) {
                const cell = rendererFor(typeOf[c])(row[c])
                tr.append(el("td", { class: cellClass(typeOf[c], c) }, [typeof cell === "string" ? document.createTextNode(cell) : cell]))
            }
            body.append(tr)
        }
    }

    selection.repaint = paint // the content screen repaints on selection change
    table.append(el("thead", {}, [head]), body)
    paint()
    // wide tables scroll INSIDE this container — the page never breaks
    return el("div", { class: "nx-scroll" }, [table])
}

export default { render }
