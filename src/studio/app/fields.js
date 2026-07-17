/**
 * Field interfaces & displays — the meta-model UI, generated from the Entity
 * schema exactly as the HTTP API is generated from it (Directus interfaces/
 * displays, Frappe controls). An INTERFACE edits a field by its type; a DISPLAY
 * renders a value read-only. Registered by `type`, so a new field type is a new
 * entry here — never per-field UI code. `buildForm`/`buildList` compose them.
 */

import { el } from "./lib.js"

const label = (field) => (field.label && (field.label.en || Object.values(field.label)[0])) || field.name

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

// ── DISPLAYS: type → value → cell (text/element) ───────────────────────────────
export const displays = {
    boolean: (v) => (v === true || v === 1 ? "✓" : v === false || v === 0 ? "✗" : ""),
    datetime: (v) => (v ? String(v).replace("T", " ").slice(0, 16) : ""),
    default: (v) => (v == null ? "" : String(v))
}
const rendererFor = (type) => displays[type] || displays.default

/** Editable columns of an Entity (system + user fields, minus child tables). */
export function editableFields(schema) {
    return (schema.fields ?? []).filter((f) => f.type !== "table")
}

/**
 * Generate a form for an Entity from its schema. Returns a <form>; `onSubmit`
 * receives the collected, type-coerced values. Booleans default false.
 */
export function buildForm(schema, { data = {}, onSubmit, submitLabel = "Save" } = {}) {
    const values = { ...data }
    const form = el("form", { class: "nx-form", onsubmit: (e) => { e.preventDefault(); onSubmit?.(values) } })
    for (const field of editableFields(schema)) {
        if (field.type === "boolean") {
            if (values[field.name] === undefined) values[field.name] = field.default ?? false
            form.append(el("div", { class: "nx-field" }, [editorFor(field)(field, values[field.name], (val) => (values[field.name] = val))]))
        } else {
            form.append(el("div", { class: "nx-field" }, [
                el("label", { class: "nx-label", text: label(field) + (field.required ? " *" : "") }),
                editorFor(field)(field, values[field.name], (val) => (values[field.name] = val))
            ]))
        }
    }
    form.append(el("div", { class: "nx-actions" }, [el("button", { class: "nx-btn primary", type: "submit", text: submitLabel })]))
    return form
}

/** Generate a table for an Entity's rows using displays. */
export function buildList(schema, rows, { onRow } = {}) {
    const cols = ["id", ...editableFields(schema).map((f) => f.name)]
    const typeOf = Object.fromEntries((schema.fields ?? []).map((f) => [f.name, f.type]))
    const table = el("table", { class: "nx-table" })
    table.append(el("thead", {}, [el("tr", {}, cols.map((c) => el("th", { text: c })))]))
    const body = el("tbody")
    for (const row of rows) {
        const tr = el("tr", onRow ? { class: "clickable", onclick: () => onRow(row) } : {})
        for (const c of cols) tr.append(el("td", { text: rendererFor(typeOf[c])(row[c]) }))
        body.append(tr)
    }
    table.append(body)
    return table
}
