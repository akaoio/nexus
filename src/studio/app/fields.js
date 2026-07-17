/**
 * Field interfaces & displays — the meta-model UI, generated from the Entity
 * schema exactly as the HTTP API is generated from it (Directus interfaces/
 * displays, Frappe controls). An INTERFACE edits a field by its type; a DISPLAY
 * renders a value read-only. Registered by `type`, so a new field type is a new
 * entry here — never per-field UI code. `buildForm`/`buildList` compose them.
 */

import { el } from "./lib.js"

const label = (field, locale) =>
    (field.label && (field.label[locale] || field.label.en || Object.values(field.label)[0])) || field.name

// ── INTERFACES: type → (field, value, onChange) → input element ────────────────
export const interfaces = {
    text: (f, v, on) => el("input", { class: "nx-input", type: "text", value: v ?? "", onchange: (e) => on(e.target.value) }),
    integer: (f, v, on) => el("input", { class: "nx-input", type: "number", step: "1", value: v ?? "", onchange: (e) => on(e.target.value === "" ? null : Math.trunc(Number(e.target.value))) }),
    number: (f, v, on) => el("input", { class: "nx-input", type: "number", value: v ?? "", onchange: (e) => on(e.target.value === "" ? null : Number(e.target.value)) }),
    boolean: (f, v, on) => el("label", { class: "nx-check" }, [el("input", { type: "checkbox", checked: !!v, onchange: (e) => on(e.target.checked) }), el("span", { text: label(f) })]),
    date: (f, v, on) => el("input", { class: "nx-input", type: "date", value: (v ?? "").slice(0, 10), onchange: (e) => on(e.target.value || null) }),
    datetime: (f, v, on) => el("input", { class: "nx-input", type: "datetime-local", value: (v ?? "").slice(0, 16), onchange: (e) => on(e.target.value || null) }),
    select: (f, v, on) => el("select", { class: "nx-input", onchange: (e) => on(e.target.value || null) },
        [el("option", { value: "", text: "—" }), ...(f.options ?? []).map((o) => el("option", { value: o, text: o, selected: v === o }))]),
    link: (f, v, on) => el("input", { class: "nx-input", type: "text", placeholder: "id of " + (f.target || "linked"), value: v ?? "", onchange: (e) => on(e.target.value || null) })
}
const editorFor = (field) => interfaces[field.type] || interfaces.text

// ── DISPLAYS: type → value → cell content (string or element) ──────────────────
export const displays = {
    boolean: (v) => (v === true || v === 1
        ? el("span", { style: "color:var(--ok)", text: "✓" })
        : v === false || v === 0 ? el("span", { class: "nx-muted", text: "✗" }) : ""),
    select: (v) => (v == null || v === "" ? "" : el("span", { class: "nx-chip", text: String(v) })),
    datetime: (v) => (v ? String(v).replace("T", " ").slice(0, 16) : ""),
    default: (v) => (v == null ? "" : String(v))
}
const rendererFor = (type) => displays[type] || displays.default

/** Column classes by type — data speaks mono, numbers align right. */
const cellClass = (type, column) => {
    if (column === "id") return "mono"
    if (type === "integer" || type === "number") return "num"
    if (type === "datetime" || type === "date") return "mono"
    return ""
}

/** Editable columns of an Entity (system + user fields, minus child tables). */
export function editableFields(schema) {
    return (schema.fields ?? []).filter((f) => f.type !== "table")
}

/**
 * Generate a form for an Entity from its schema. Returns a <form>; `onSubmit`
 * receives the collected, type-coerced values. Booleans default false.
 * Ctrl/Cmd+Enter submits from anywhere in the form.
 */
export function buildForm(schema, { data = {}, onSubmit, submitLabel = "Save", locale } = {}) {
    const values = { ...data }
    const form = el("form", {
        class: "nx-form",
        onsubmit: (e) => { e.preventDefault(); onSubmit?.(values) },
        onkeydown: (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onSubmit?.(values) } }
    })
    for (const field of editableFields(schema)) {
        if (field.type === "boolean") {
            if (values[field.name] === undefined) values[field.name] = field.default ?? false
            form.append(el("div", { class: "nx-field" }, [editorFor(field)(field, values[field.name], (val) => (values[field.name] = val))]))
        } else {
            form.append(el("div", { class: "nx-field" }, [
                el("label", { class: "nx-label", text: label(field, locale) + (field.required ? " *" : "") }),
                editorFor(field)(field, values[field.name], (val) => (values[field.name] = val))
            ]))
        }
    }
    form.append(el("div", { class: "nx-actions" }, [el("button", { class: "nx-btn primary", type: "submit", text: submitLabel })]))
    return form
}

/** Stable sort with strict types and nulls-last (both directions). */
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

/**
 * Generate a table for an Entity's rows using displays: sortable headers,
 * type-aware cells, clickable rows (`onRow`). The mandatory system fields
 * every Entity carries (id, owner, created_at, updated_at — maintained by the
 * Data Plane, Frappe-style) are first-class columns.
 */
export function buildList(schema, rows, { onRow } = {}) {
    const cols = ["id", ...editableFields(schema).map((f) => f.name), "owner", "updated_at"]
    const typeOf = {
        owner: "text", created_at: "datetime", updated_at: "datetime",
        ...Object.fromEntries((schema.fields ?? []).map((f) => [f.name, f.type]))
    }
    const sort = { field: null, dir: "asc" }
    const table = el("table", { class: "nx-table" })

    const head = el("tr", {}, cols.map((c) =>
        el("th", {
            class: "sortable",
            text: c,
            onclick: () => {
                if (sort.field === c) sort.dir = sort.dir === "asc" ? "desc" : "asc"
                else { sort.field = c; sort.dir = "asc" }
                paint()
            }
        })
    ))
    table.append(el("thead", {}, [head]))
    const body = el("tbody")
    table.append(body)

    function paint() {
        head.querySelectorAll("th").forEach((th, i) => {
            th.textContent = cols[i] + (sort.field === cols[i] ? (sort.dir === "asc" ? " ↑" : " ↓") : "")
        })
        body.replaceChildren()
        const view = sort.field ? sortBy(rows, sort.field, sort.dir) : rows
        for (const row of view) {
            const tr = el("tr", onRow ? { class: "clickable", onclick: () => onRow(row) } : {})
            for (const c of cols) {
                const cell = rendererFor(typeOf[c])(row[c])
                tr.append(el("td", { class: cellClass(typeOf[c], c) }, [typeof cell === "string" ? document.createTextNode(cell) : cell]))
            }
            body.append(tr)
        }
    }
    paint()
    return table
}
