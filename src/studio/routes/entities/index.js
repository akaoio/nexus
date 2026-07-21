/** /entities route — the entity DIRECTORY: a real list view over every
 *  loaded definition (click a row to edit), create, and cascade DELETE
 *  behind a dry-run plan + typed confirmation. Views are declared here
 *  (schema `views:` — opt-in, never automatic). */

import { mountTemplate, button, text, toast , control, labelledField } from "../../kit/index.js"
import { createSelection } from "../../kit/selection.js"
import { VIEWS } from "../../views/index.js"
import * as list from "../../views/list.js"
import { boardField } from "../../views/kanban.js"
import { ICONS } from "../../components/icon/icons.js"
import { entitiesTemplate } from "./template.js"

const NEW = Symbol("new")

/** The directory's own shape — the list view renders entities AS rows. */
const DIRECTORY = {
    name: "nexus_entity",
    schemaVersion: 1,
    fields: [
        { name: "name", type: "text", label: { en: "Name" } },
        { name: "label", type: "text", label: { en: "Label" } },
        { name: "fields", type: "integer", label: { en: "Fields" } },
        { name: "views", type: "text", label: { en: "Views" } },
        { name: "records", type: "integer", label: { en: "Records" } },
        { name: "file", type: "text", label: { en: "Source" } }
    ]
}

export function render(ctx) {
    const c = {}
    let editing = null // null = directory; NEW = create; else the entity name
    const host = mountTemplate(entitiesTemplate(c, { onNew: () => { editing = NEW; paint() } }))

    const card = (children) => {
        const wrap = document.createElement("div")
        wrap.className = "nx-card"
        wrap.append(...children)
        return wrap
    }
    const actions = (...buttons) => {
        const wrap = document.createElement("div")
        wrap.className = "nx-actions"
        wrap.append(...buttons)
        return wrap
    }

    async function save(schema) {
        if (!schema || !schema.name) return toast("Entity name is required", "err")
        const r = await ctx.api.studio("model", "POST", { ...schema, schemaVersion: 1 })
        toast(r.ok ? "Entity saved — applied live" : r.error.code + ": " + (r.error.message || ""), r.ok ? "ok" : "err")
        // the boot payload carries schemas — a refresh picks up the new shape
        if (r.ok) setTimeout(() => location.reload(), 600)
    }

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
        hint.append(text("viewsHint", "Only the views declared here appear on the entity - nothing is automatic."))
        wrap.append(h, row, hint)
        return { section: wrap, value: () => [...boxes.entries()].filter(([, b]) => b.checked).map(([id]) => id) }
    }

    /** The entity's mark: any bootstrap-icons name (vendored sprite renders
     *  the full set); the registry names ride a datalist as suggestions. */
    function iconSection(schema) {
        const wrap = document.createElement("div")
        wrap.className = "nx-setsec"
        const h = document.createElement("h3")
        h.append(text("icon", "Icon"))
        const row = document.createElement("div")
        row.className = "nx-toolbar"
        const preview = document.createElement("nx-icon")
        preview.setAttribute("name", schema?.icon || "database")
        const input = control("input", { placeholder: "bootstrap icon name, e.g. cart4", value: schema?.icon ?? "" })
        input.style.maxWidth = "16rem"
        input.setAttribute("list", "nx-icon-names")
        const list = document.createElement("datalist")
        list.id = "nx-icon-names"
        for (const name of Object.keys(ICONS).sort()) {
            const option = document.createElement("option")
            option.value = name
            list.append(option)
        }
        input.addEventListener("input", () => preview.setAttribute("name", input.value.trim() || (schema?.icon ?? "database")))
        row.append(preview, input, list)
        const hint = document.createElement("p")
        hint.className = "nx-muted"
        hint.textContent = "Any name from icons.getbootstrap.com — the sidebar and lists wear it."
        wrap.append(h, row, hint)
        return { section: wrap, value: () => input.value.trim() }
    }

    /** Cascade delete: fetch the DRY-RUN plan, show EVERYTHING it will
     *  destroy, execute only when the human types the name back. */
    async function confirmDelete(name) {
        const r = await ctx.api.get("/_studio/entity-delete?name=" + encodeURIComponent(name))
        if (!r.ok) return toast(r.error.code + ": " + (r.error.message || ""), "err")
        const plan = r.data
        const modal = document.createElement("nx-modal")
        modal.dataset.header = "Delete " + name
        const body = document.createElement("div")
        body.style.display = "grid"
        body.style.gap = "var(--sp-3)"
        const lines = [
            plan.rowCount + " record(s) + table + embeddings",
            "schema file " + plan.schemaFile,
            plan.dbPolicies.length + " live policy row(s)",
            ...plan.baselineOrphans.map((o) => "app baseline policy (" + o.source + ") becomes orphaned — flagged, not deleted"),
            ...plan.linkDrops.map((d) => d.entity + "." + d.field + " (link → " + name + ") — column DROPPED"),
            plan.views.length + " saved view(s)",
            ...(plan.rolesAffected.length ? ["roles losing a grant: " + plan.rolesAffected.join(", ") + " (the roles themselves stay)"] : [])
        ]
        const ul = document.createElement("ul")
        ul.style.margin = "0"
        ul.style.paddingLeft = "1.25rem"
        for (const line of lines) {
            const li = document.createElement("li")
            li.textContent = line
            ul.append(li)
        }
        const prompt = document.createElement("p")
        prompt.className = "nx-muted"
        prompt.style.margin = "0"
        prompt.textContent = 'This cannot be undone. Type "' + name + '" to confirm.'
        const input = control("input", { placeholder: name })
        const row = document.createElement("div")
        row.className = "nx-actions"
        const cancel = button({ onclick: () => modal.close() }, [text("cancel")])
        const go = button({
            variant: "danger", disabled: true,
            onclick: async () => {
                const rr = await ctx.api.post("/_studio/entity-delete", { name, confirm: input.value.trim() })
                if (!rr.ok) return toast(rr.error.code + ": " + (rr.error.message || ""), "err")
                toast("Deleted " + name + " — applied live")
                modal.close()
                setTimeout(() => location.reload(), 600)
            }
        }, ["Delete forever"])
        input.addEventListener("input", () => {
            if (input.value.trim() === name) go.removeAttribute("disabled")
            else go.setAttribute("disabled", "")
        })
        row.append(cancel, go)
        body.append(ul, prompt, input, row)
        modal.append(body)
        document.body.append(modal)
        modal.addEventListener("close", () => modal.remove())
        modal.showModal()
    }

    async function paintDirectory() {
        c.$crumb.textContent = ""
        const r = await ctx.api.get("/_studio/entities")
        const rows = r.ok ? r.data : []
        const table = list.render({
            schema: DIRECTORY,
            rows,
            selection: createSelection(rows.map((x) => x.name)),
            onRow: (row) => { editing = row.name; paint() }
        })
        c.$body.replaceChildren(card([table]))
    }

    function paintEditor() {
        const isNew = editing === NEW
        c.$crumb.textContent = isNew ? "new" : editing
        const back = button({ variant: "icon", iconName: "x-lg", title: "Back to the directory", onclick: () => { editing = null; paint() } })
        if (isNew) {
            const name = control("input", { placeholder: "Entity name (e.g. customer)" })
            const fieldWrap = labelledField(text("name"), name)
            const builder = document.createElement("nx-form-builder")
            const create = button({ variant: "primary", onclick: () => save({ ...(builder.value || { fields: [] }), name: name.value.trim() }) }, [text("createCollection")])
            c.$body.replaceChildren(card([fieldWrap, builder, actions(back, create)]))
            name.focus()
            return
        }
        const baseline = ctx.schemas.find((s) => s.name === editing)
        if (!baseline) {
            editing = null
            return paintDirectory()
        }
        const designer = document.createElement("nx-schema-designer")
        designer.baseline = baseline
        const views = viewsSection(baseline)
        const iconSec = iconSection(baseline)
        const saveBtn = button({
            variant: "primary",
            onclick: () => {
                const declared = views.value()
                const next = { ...baseline, ...designer.value }
                if (declared.length) next.views = declared
                else delete next.views
                const mark = iconSec.value()
                if (mark) next.icon = mark
                else delete next.icon
                save(next)
            }
        }, [text("saveChanges")])
        const del = button({ variant: "danger", iconName: "trash", onclick: () => confirmDelete(editing) }, ["Delete"])
        const spread = document.createElement("span")
        spread.className = "nx-spacer"
        c.$body.replaceChildren(card([designer, iconSec.section, views.section, actions(back, del, spread, saveBtn)]))
    }

    function paint() {
        if (editing === null) paintDirectory()
        else paintEditor()
    }
    paint()
    return host
}
