/** /entity (data model) route — logic: create a new Entity or edit an
 *  existing one and SAVE (reuses <nx-form-builder> / <nx-schema-designer>).
 *  Views are declared HERE (schema `views:` — opt-in, never automatic). */

import { mountTemplate, button, text, toast } from "../../kit/index.js"
import { VIEWS } from "../../views/index.js"
import { boardField } from "../../views/kanban.js"
import { modelTemplate } from "./template.js"

export function render(ctx) {
    const c = {}
    let editing = ctx.state.entity && ctx.schemas.some((s) => s.name === ctx.state.entity) ? ctx.state.entity : ctx.schemas[0]?.name ?? null
    const host = mountTemplate(modelTemplate(c, { onNew: () => { editing = null; paint() } }))

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

    /** The views an entity opts into — a checklist over the Studio registry.
     *  Returns { section, value() } so save() reads the CURRENT selection. */
    function viewsSection(schema) {
        const wrap = document.createElement("div")
        wrap.className = "nx-setsec"
        const h = document.createElement("h3")
        h.append(text("views", "Views"))
        const row = document.createElement("div")
        row.className = "nx-options"
        const boxes = new Map()
        for (const v of VIEWS) {
            const label = document.createElement("label")
            label.className = "nx-check"
            const box = document.createElement("input")
            box.type = "checkbox"
            box.checked = (schema?.views ?? ["list"]).includes(v.id)
            if (v.id === "kanban" && !boardField(schema)) {
                box.disabled = true
                label.title = "Kanban needs a select or boolean field to lay lanes on"
            }
            boxes.set(v.id, box)
            label.append(box, v.label)
            row.append(label)
        }
        const hint = document.createElement("p")
        hint.className = "nx-muted"
        hint.append(text("viewsHint", "Only the views declared here appear on the entity — nothing is automatic."))
        wrap.append(h, row, hint)
        return { section: wrap, value: () => [...boxes.entries()].filter(([, b]) => b.checked).map(([id]) => id) }
    }

    function paintPicker() {
        c.$picker.replaceChildren(...ctx.schemas.map((s) => {
            const tile = button({ variant: "option", onclick: () => { editing = s.name; paint() } }, [
                Object.assign(document.createElement("strong"), { textContent: s.name }),
                Object.assign(document.createElement("span"), { className: "nx-muted", textContent: `${(s.fields ?? []).length} fields` })
            ])
            tile.toggleAttribute("data-on", s.name === editing)
            return tile
        }))
    }

    function paint() {
        paintPicker()
        c.$body.replaceChildren()
        if (!editing) {
            // new entity: name it, shape its fields, create
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
            name.focus()
            return
        }
        const baseline = ctx.schemas.find((s) => s.name === editing)
        const designer = document.createElement("nx-schema-designer")
        designer.baseline = baseline
        const views = viewsSection(baseline)
        const saveBtn = button({
            variant: "primary",
            onclick: () => {
                // keys the designer does not model (semantic, indexes, views…)
                // survive from the baseline; the checklist decides views
                const declared = views.value()
                const next = { ...baseline, ...designer.value }
                if (declared.length) next.views = declared
                else delete next.views
                save(next)
            }
        }, [text("saveChanges")])
        c.$body.append(card([designer, views.section, actions(saveBtn)]))
    }
    paint()
    return host
}
