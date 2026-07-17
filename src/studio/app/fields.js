/**
 * Field interfaces & displays — the meta-model UI, generated from the Entity
 * schema exactly as the HTTP API is generated from it (Directus interfaces/
 * displays, Frappe controls). An INTERFACE edits a field by its type; a DISPLAY
 * renders a value read-only. Registered by `type`, so a new field type is a new
 * entry here — never per-field UI code. `buildForm`/`buildList` compose them.
 */

import { el, icon } from "./lib.js"

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
        ? el("span", { style: "color:var(--ok);display:inline-flex" }, [icon("check-lg")])
        : v === false || v === 0 ? el("span", { class: "nx-muted", style: "display:inline-flex;opacity:.6" }, [icon("x")]) : ""),
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
