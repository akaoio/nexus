/** /entity (data model) route — logic: create a new Entity or edit an
 *  existing one and SAVE (reuses <nx-form-builder> / <nx-schema-designer>). */

import { mountTemplate, button, text, toast } from "../../lib.js"
import { modelTemplate } from "./template.js"

export function render(ctx) {
    const c = {}
    const host = mountTemplate(modelTemplate(c))

    const newOption = document.createElement("option")
    newOption.value = "__new"
    newOption.textContent = "+ " + ctx.i18n.resolve("newCollection")
    c.$picker.append(newOption, ...ctx.schemas.map((s) => {
        const option = document.createElement("option")
        option.value = s.name
        option.textContent = s.name
        return option
    }))
    c.$picker.value = ctx.state.entity || "__new"

    async function save(schema) {
        if (!schema || !schema.name) return toast("Entity name is required", "err")
        const r = await ctx.api.studio("model", "POST", { ...schema, schemaVersion: 1 })
        toast(r.ok ? "Entity saved — restart nexus dev to load it" : r.error.code + ": " + (r.error.message || ""), r.ok ? "ok" : "err")
    }

    const card = (children) => {
        const wrap = document.createElement("div")
        wrap.className = "nx-card"
        wrap.append(...children)
        return wrap
    }
    const actions = (btn) => {
        const wrap = document.createElement("div")
        wrap.className = "nx-actions"
        wrap.append(btn)
        return wrap
    }

    function mountBody() {
        c.$body.replaceChildren()
        if (c.$picker.value === "__new") {
            const name = document.createElement("input")
            name.className = "nx-input"
            name.placeholder = "Entity name (e.g. customer)"
            const fieldWrap = document.createElement("div")
            fieldWrap.className = "nx-field"
            const label = document.createElement("label")
            label.className = "nx-label"
            label.append(text("name"))
            fieldWrap.append(label, name)
            const builder = document.createElement("nx-form-builder")
            const create = button({ variant: "primary", onclick: () => save({ ...(builder.value || { fields: [] }), name: name.value.trim() }) }, [text("createCollection")])
            c.$body.append(card([fieldWrap, builder, actions(create)]))
        } else {
            const designer = document.createElement("nx-schema-designer")
            designer.baseline = ctx.schemas.find((s) => s.name === c.$picker.value)
            const saveBtn = button({ variant: "primary", onclick: () => save(designer.value) }, [text("saveChanges")])
            c.$body.append(card([designer, actions(saveBtn)]))
        }
    }
    c.$picker.addEventListener("change", mountBody)
    mountBody()
    return host
}
