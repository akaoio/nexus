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

/**
 * One input element, classed and wired — the kit's control primitive.
 *
 * EXPORTED because it was private, and four files each rebuilt it: settings,
 * entities, entity/[entity] and this module. "One kit for DOM" (§7.1) only
 * holds if the kit hands the primitive out; a private one is a rule people
 * route around by writing their own (NXFP-01/02).
 */
export function control(tag, props, onchange) {
    const node = document.createElement(tag)
    node.className = "nx-input"
    Object.assign(node, props)
    if (onchange) node.addEventListener("change", onchange)
    return node
}

/**
 * The bare `.nx-field` wrapper. Separate from labelledField because a boolean's
 * interface carries its own label (the checkbox's text), so it needs the
 * wrapper WITHOUT a second label above it — and that exception is the reason
 * buildForm used to rebuild the class inline, which is how the fourth copy of
 * this markup came to exist.
 */
export function fieldWrap(...children) {
    const wrap = document.createElement("div")
    wrap.className = "nx-field"
    wrap.append(...children.filter(Boolean))
    return wrap
}

/**
 * A labelled field: the `.nx-field` wrapper around a `.nx-label` and a control.
 *
 * ONE definition, because there were four — this module built it inside
 * buildForm while three routes each built their own, so changing what a
 * labelled field looks like meant finding every copy and hoping. The wrapper is
 * returned rather than styled here; a caller that wants a width sets it on what
 * it gets back, instead of this growing an options bag for every page.
 *
 * @param {string|Node} text - the label, as text or an element (i18n)
 * @param {Node} controlEl - the input this labels
 * @param {{required?: boolean}} [options]
 */
export function labelledField(text, controlEl, { required = false } = {}) {
    const wrap = fieldWrap()
    const label = document.createElement("label")
    label.className = "nx-label"
    // A Node as well as a string: the entities editor labels its name field
    // with an <nx-context> i18n element, and forcing that through textContent
    // would have meant it keeping its own copy of the wrapper instead.
    if (text instanceof Node) label.append(text)
    else label.textContent = String(text ?? "")
    if (required) label.append(" *")
    wrap.append(label, controlEl)
    return wrap
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
        // A boolean's interface carries its own label (the checkbox's text), so
        // it gets the wrapper without a second one above it.
        const editor = interfaceFor(field, overrides)(field, values[field.name], (val) => (values[field.name] = val))
        let wrap
        if (field.type === "boolean") {
            if (values[field.name] === undefined) values[field.name] = field.default ?? false
            wrap = fieldWrap(editor)
        } else {
            wrap = labelledField(label(field, locale), editor, { required: field.required === true })
        }
        wrap.style.gridColumn = "span " + (field.span ?? 3)
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
