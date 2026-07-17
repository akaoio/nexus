/**
 * <nx-form-builder> + <nx-form> — the Model Schema editor and the form
 * runtime (ARCHITECTURE.md §7).
 *
 * The builder's OUTPUT is a real Model Schema v1 document: `.value` accepts
 * and returns schema docs (always clones); every edit emits "change" with
 * { value, valid } where `valid` is Model.validate's verdict — the golden
 * invariant: the flag NEVER disagrees with the validator (transient invalid
 * states while typing are allowed, but always flagged).
 *
 * Scope, honestly: schemaVersion 1 is frozen and carries no layout key
 * (MS-S09), so v1 of the builder edits FIELDS and their ORDER — the field
 * array order is the form order. Sections/columns/tabs arrive with
 * schemaVersion 2 through the N4 upgrade path, never by sneaking keys in.
 *
 * <nx-form> renders a working form straight from a schema — no codegen:
 * one input per field type, required markers, `.value` in/out, "change" and
 * "submit" events. The builder embeds one as a LIVE PREVIEW: the editor
 * proves its output renders, permanently.
 *
 * akao triad: logic here, templates in template.js, styles in styles.css.js.
 */

import { Component } from "../../../kernel/UI/Component.js"
import { render } from "../../../kernel/UI.js"
import { validate, FIELD_TYPES } from "../../../model/Model.js"
import { defaultValue } from "../query-builder/index.js"
import { formTemplate, builderTemplate } from "./template.js"

const clone = (x) => JSON.parse(JSON.stringify(x))

// ─── pure helpers (pinned in Node) ────────────────────────────────────────────

/** A fresh text field with the first free generated name. */
export function emptyField(schema) {
    const taken = new Set((schema?.fields ?? []).map((f) => f.name))
    let n = 1
    while (taken.has(`field_${n}`)) n++
    return { name: `field_${n}`, type: "text" }
}

/** Move fields[index] by delta (clamped). Mutates and returns the array. */
export function moveField(fields, index, delta) {
    const target = index + delta
    if (index < 0 || index >= fields.length || target < 0 || target >= fields.length) return fields
    const [field] = fields.splice(index, 1)
    fields.splice(target, 0, field)
    return fields
}

/** Switch a field's type, resetting type-specific properties coherently. */
export function resetType(field, type) {
    field.type = type
    delete field.options
    delete field.target
    delete field.default
    if (type === "select") field.options = ["option_1"]
    if (type === "link" || type === "table") field.target = "entity"
    return field
}

/** An empty, valid v1 schema shell. */
export const emptySchema = () => ({ schemaVersion: 1, name: "entity", fields: [] })

export { defaultValue }

// ─── <nx-form> — the form runtime: schema in, data out, no codegen ───────────

export class NxForm extends Component {
    #schema = null
    #data = {}

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

    set value(data) {
        this.#data = clone(data ?? {})
        if (this.isConnected) this.mount()
    }

    get value() {
        return clone(this.#data)
    }

    onconnect() {
        this.mount()
    }

    #emit() {
        this.dispatchEvent(new CustomEvent("change", { detail: { value: this.value }, bubbles: true, composed: true }))
    }

    mount() {
        render(formTemplate(this), this.shadowRoot)
        for (const field of this.#schema?.fields ?? []) {
            if (field.type === "table") continue
            const row = document.createElement("div")
            row.className = "field"
            const label = document.createElement("label")
            label.textContent = field.label?.en ?? field.name
            if (field.required === true) label.innerHTML += ' <span class="required-mark">*</span>'
            row.appendChild(label)
            row.appendChild(this.#input(field))
            this.$form.appendChild(row)
        }
        const submit = document.createElement("button")
        submit.type = "button"
        submit.className = "submit"
        submit.textContent = "Submit"
        this.listen(submit, "click", () =>
            this.dispatchEvent(new CustomEvent("submit", { detail: { value: this.value }, bubbles: true, composed: true }))
        )
        this.$form.appendChild(submit)
    }

    #input(field) {
        const set = (value) => {
            if (value === "" || value === undefined) delete this.#data[field.name]
            else this.#data[field.name] = value
            this.#emit()
        }
        if (field.type === "boolean") {
            const el = document.createElement("input")
            el.type = "checkbox"
            el.dataset.field = field.name
            el.checked = this.#data[field.name] === true
            this.listen(el, "change", () => set(el.checked))
            return el
        }
        if (field.type === "select") {
            const el = document.createElement("select")
            el.dataset.field = field.name
            el.appendChild(document.createElement("option")) // empty choice
            for (const option of field.options ?? []) {
                const opt = document.createElement("option")
                opt.value = option
                opt.textContent = option
                el.appendChild(opt)
            }
            el.value = this.#data[field.name] ?? ""
            this.listen(el, "change", () => set(el.value))
            return el
        }
        const el = document.createElement("input")
        el.dataset.field = field.name
        el.type =
            field.type === "integer" || field.type === "number" ? "number"
            : field.type === "date" ? "date"
            : field.type === "datetime" ? "datetime-local"
            : "text"
        el.value = this.#data[field.name] ?? ""
        this.listen(el, "input", () => {
            if (field.type === "integer") set(el.value === "" ? "" : Math.trunc(Number(el.value)))
            else if (field.type === "number") set(el.value === "" ? "" : Number(el.value))
            else set(el.value)
        })
        return el
    }
}

// ─── <nx-form-builder> — edit the schema itself ──────────────────────────────

export class NxFormBuilder extends Component {
    #schema = emptySchema()

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
    }

    get value() {
        return clone(this.#schema)
    }

    set value(schema) {
        this.#schema = clone(schema ?? emptySchema())
        if (this.isConnected) this.mount()
    }

    onconnect() {
        this.mount()
    }

    #emit() {
        this.dispatchEvent(
            new CustomEvent("change", {
                detail: { value: this.value, valid: validate(this.#schema).valid },
                bubbles: true,
                composed: true
            })
        )
        this.#refreshPreview()
    }

    #structural() {
        this.mount()
        this.#emit()
    }

    #refreshPreview() {
        if (this.$preview) this.$preview.schema = this.value
    }

    mount() {
        const schema = this.#schema
        render(builderTemplate(this, {
            schema,
            onName: (name) => {
                schema.name = name
                this.#emit()
            },
            onLabel: (label) => {
                if (label === "") delete schema.label
                else schema.label = { ...(schema.label ?? {}), en: label }
                this.#emit()
            },
            onAddField: () => {
                schema.fields.push(emptyField(schema))
                this.#structural()
            }
        }), this.shadowRoot)

        schema.fields.forEach((field, index) => this.$rows.appendChild(this.#row(field, index)))

        this.$preview = document.createElement("nx-form")
        this.$preview.schema = this.value
        // Preview events must not escape as the BUILDER's events
        this.$preview.addEventListener("change", (e) => e.stopPropagation())
        this.$preview.addEventListener("submit", (e) => e.stopPropagation())
        this.$previewSlot.appendChild(this.$preview)
    }

    #row(field, index) {
        const schema = this.#schema
        const row = document.createElement("div")
        row.className = "row"

        const name = document.createElement("input")
        name.className = "name"
        name.value = field.name
        name.title = "field name"
        this.listen(name, "input", () => {
            field.name = name.value
            this.#emit()
        })
        row.appendChild(name)

        const type = document.createElement("select")
        type.className = "type"
        for (const t of FIELD_TYPES) {
            const option = document.createElement("option")
            option.value = t
            option.textContent = t
            type.appendChild(option)
        }
        type.value = field.type
        this.listen(type, "change", () => {
            resetType(field, type.value)
            this.#structural()
        })
        row.appendChild(type)

        const label = document.createElement("input")
        label.className = "label"
        label.placeholder = "label (en)"
        label.value = field.label?.en ?? ""
        this.listen(label, "input", () => {
            if (label.value === "") delete field.label
            else field.label = { ...(field.label ?? {}), en: label.value }
            this.#emit()
        })
        row.appendChild(label)

        if (field.type === "select") {
            const options = document.createElement("input")
            options.className = "extra options"
            options.placeholder = "options, comma-separated"
            options.value = (field.options ?? []).join(", ")
            this.listen(options, "input", () => {
                field.options = options.value.split(",").map((s) => s.trim()).filter((s) => s !== "")
                this.#emit()
            })
            row.appendChild(options)
        }
        if (field.type === "link" || field.type === "table") {
            const target = document.createElement("input")
            target.className = "extra target"
            target.placeholder = "target entity"
            target.value = field.target ?? ""
            this.listen(target, "input", () => {
                field.target = target.value
                this.#emit()
            })
            row.appendChild(target)
        }

        const required = document.createElement("label")
        required.innerHTML = "req "
        const box = document.createElement("input")
        box.type = "checkbox"
        box.className = "required"
        box.checked = field.required === true
        this.listen(box, "change", () => {
            if (box.checked) field.required = true
            else delete field.required
            this.#emit()
        })
        required.appendChild(box)
        row.appendChild(required)

        const up = document.createElement("button")
        up.className = "up"
        up.textContent = "↑"
        this.listen(up, "click", () => {
            moveField(schema.fields, index, -1)
            this.#structural()
        })
        row.appendChild(up)

        const down = document.createElement("button")
        down.className = "down"
        down.textContent = "↓"
        this.listen(down, "click", () => {
            moveField(schema.fields, index, 1)
            this.#structural()
        })
        row.appendChild(down)

        const remove = document.createElement("button")
        remove.className = "remove"
        remove.textContent = "×"
        this.listen(remove, "click", () => {
            schema.fields.splice(index, 1)
            this.#structural()
        })
        row.appendChild(remove)

        return row
    }
}

if (typeof customElements !== "undefined") {
    customElements.define("nx-form", NxForm)
    customElements.define("nx-form-builder", NxFormBuilder)
}
