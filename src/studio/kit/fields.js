/**
 * Field interfaces & displays — the meta-model UI, generated from the Entity
 * schema exactly as the HTTP API is generated from it (Directus interfaces/
 * displays, Frappe controls). An INTERFACE edits a field by its type; a
 * DISPLAY renders a value read-only. Registered by `type`, so a new field
 * type is a new entry here — never per-field UI code. Raw platform elements
 * + primitives only (the akao dynamic style): no ad-hoc DOM helpers.
 */

import { icon, button, text } from "./index.js"
import { parseTags, serializeTags } from "./tags.js"
import { resolveInterface } from "./registry.js"

const label = (field, locale) =>
    (field.label && (field.label[locale] || field.label.en || Object.values(field.label)[0])) || field.name

/** One input element, classed and wired. */
function control(tag, props, onchange) {
    const node = document.createElement(tag)
    node.className = "nx-input"
    Object.assign(node, props)
    if (onchange) node.addEventListener("change", onchange)
    return node
}

// ── INTERFACES: type → (field, value, onChange) → input element ────────────────
export const interfaces = {
    text: (f, v, on) => control("input", { type: "text", value: v ?? "" }, (e) => on(e.target.value)),
    integer: (f, v, on) => control("input", { type: "number", step: "1", value: v ?? "" }, (e) => on(e.target.value === "" ? null : Math.trunc(Number(e.target.value)))),
    number: (f, v, on) => control("input", { type: "number", value: v ?? "" }, (e) => on(e.target.value === "" ? null : Number(e.target.value))),
    boolean: (f, v, on) => {
        const wrap = document.createElement("label")
        wrap.className = "nx-check"
        const box = document.createElement("input")
        box.type = "checkbox"
        box.checked = !!v
        box.addEventListener("change", () => on(box.checked))
        const text = document.createElement("span")
        text.textContent = label(f)
        wrap.append(box, text)
        return wrap
    },
    /**
     * A multi-select over a live option list, with free entry — the shape the
     * users page needed for roles and built by hand, where no other entity
     * could reach it. `field.options` seeds the boxes; anything typed is added
     * and checked, so a role that does not exist yet can be granted in place.
     * Stores the JSON a text column holds (parseTags/serializeTags).
     */
    tags: (f, v, on) => {
        const wrap = document.createElement("div")
        const grid = document.createElement("div")
        grid.className = "nx-options"
        const held = new Set(parseTags(v))
        const known = new Set([...(f.options ?? []), ...held])
        const boxFor = (name) => {
            const label = document.createElement("label")
            label.className = "nx-check"
            const box = document.createElement("input")
            box.type = "checkbox"
            box.checked = held.has(name)
            box.addEventListener("change", () => {
                box.checked ? held.add(name) : held.delete(name)
                on(serializeTags([...held]))
            })
            label.append(box, name)
            return label
        }
        for (const name of known) grid.append(boxFor(name))
        const extra = document.createElement("input")
        extra.className = "nx-input"
        extra.placeholder = "new — Enter adds it"
        extra.addEventListener("keydown", (event) => {
            if (event.key !== "Enter") return
            event.preventDefault() // Enter in a form field would otherwise submit
            const name = extra.value.trim()
            if (!name || known.has(name)) { extra.value = ""; return }
            known.add(name)
            held.add(name)
            grid.append(boxFor(name))
            on(serializeTags([...held]))
            extra.value = ""
        })
        wrap.append(grid, extra)
        return wrap
    },
    date: (f, v, on) => control("input", { type: "date", value: (v ?? "").slice(0, 10) }, (e) => on(e.target.value || null)),
    datetime: (f, v, on) => control("input", { type: "datetime-local", value: (v ?? "").slice(0, 16) }, (e) => on(e.target.value || null)),
    select: (f, v, on) => {
        const select = control("select", {}, (e) => on(e.target.value || null))
        const none = document.createElement("option")
        none.value = ""
        none.textContent = "—"
        select.append(none, ...(f.options ?? []).map((o) => {
            const option = document.createElement("option")
            option.value = o
            option.textContent = o
            option.selected = v === o
            return option
        }))
        return select
    },
    link: (f, v, on) => control("input", { type: "text", placeholder: "id of " + (f.target || "linked"), value: v ?? "" }, (e) => on(e.target.value || null))
}
/** The registry's answer for a field — the rule lives in ./registry.js so it
 *  is assertable under Node; this binds it to the interfaces above. */
export const interfaceFor = (field, overrides = null) => resolveInterface(field, interfaces, overrides)



// ── DISPLAYS: type → value → cell content (string or element) ──────────────────
const mark = (name, style) => {
    const span = document.createElement("span")
    span.setAttribute("style", style)
    span.append(icon(name))
    return span
}
export const displays = {
    boolean: (v) => (v === true || v === 1
        ? mark("check-lg", "color:var(--ok);display:inline-flex")
        : v === false || v === 0 ? mark("x", "color:var(--muted);opacity:.6;display:inline-flex") : ""),
    select: (v) => {
        if (v == null || v === "") return ""
        const chip = document.createElement("span")
        chip.className = "nx-chip"
        chip.textContent = String(v)
        return chip
    },
    datetime: (v) => (v ? String(v).replace("T", " ").slice(0, 16) : ""),
    default: (v) => (v == null ? "" : String(v))
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
export function buildForm(schema, { data = {}, onSubmit, submitLabel = "Save", locale, interfaces: overrides = null, fields: only = null } = {}) {
    const values = { ...data }
    const form = document.createElement("form")
    form.className = "nx-form nx-form-grid"
    form.addEventListener("submit", (e) => { e.preventDefault(); onSubmit?.(values) })
    form.addEventListener("keydown", (e) => { if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); onSubmit?.(values) } })
    for (const field of editableFields(schema).filter((f) => !only || only.includes(f.name))) {
        const wrap = document.createElement("div")
        wrap.className = "nx-field"
        wrap.style.gridColumn = "span " + (field.span ?? 3)
        if (field.type === "boolean") {
            if (values[field.name] === undefined) values[field.name] = field.default ?? false
        } else {
            const l = document.createElement("label")
            l.className = "nx-label"
            l.textContent = label(field, locale) + (field.required ? " *" : "")
            wrap.append(l)
        }
        wrap.append(interfaceFor(field, overrides)(field, values[field.name], (val) => (values[field.name] = val)))
        form.append(wrap)
    }
    const actions = document.createElement("div")
    actions.className = "nx-actions"
    actions.style.gridColumn = "1 / -1"
    const submit = button({ variant: "primary", onclick: () => form.requestSubmit() }, [submitLabel === "Save" ? text("save") : submitLabel])
    actions.append(submit)
    form.append(actions)
    return form
}
