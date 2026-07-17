/**
 * /entity/[entity] route — logic: browse, create, edit, delete records; the
 * one Ask box (filter expressions OR relevance search); the unlimited-depth
 * visual filter; bulk operations over the pure selection model; the view
 * registry (list, kanban, …). Structure lives in template.js.
 */

import { mountTemplate, button, icon, text, toast, confirmDialog } from "../../../kit.js"
import { buildForm, editableFields, interfaces } from "../../../fields.js"
import { hexSVG } from "../../../css/elements/bits.css.js"
import { activeFilter } from "../../../components/query-builder/index.js"
import { createSelection } from "../../../selection.js"
import { cached, remember } from "../../../cache.js"
import { VIEWS } from "../../../views/index.js"
import { entityTemplate } from "./template.js"

const countLeaves = (node) => (!node ? 0 : node.field ? 1 : node.children.reduce((n, c) => n + countLeaves(c), 0))

export function render(ctx) {
    const s = ctx.schemas.find((x) => x.name === ctx.state.entity)
    if (!s) {
        const empty = document.createElement("div")
        empty.className = "nx-empty"
        empty.textContent = "No Entity selected"
        return empty
    }

    let currentRows = []
    let viewId = localStorage.getItem("nexus-view-" + s.name) || "list"

    const c = {}
    const host = mountTemplate(entityTemplate(c, {
        name: s.name,
        onNew: openCreate,
        onAsk: runAsk,
        onClear: () => {
            c.$ask.value = ""
            builder.value = null
            refresh()
        },
        onToggleFilter: () => (c.$filterCard.hidden = !c.$filterCard.hidden)
    }))
    c.$ask.placeholder = ctx.i18n.resolve("ask") + '… e.g. done = false, "chưa xong", due < today'

    // the pure selection model — every view paints from it (SEL-* clauses)
    const selection = createSelection(() => {
        paintBulkbar()
        selection.repaint?.()
    })

    function paintBulkbar() {
        c.$bulkbar.hidden = selection.size === 0
        if (c.$bulkbar.hidden) return
        const label = document.createElement("b")
        label.append(text("selectedCount", null, [selection.size]))
        const spacer = document.createElement("span")
        spacer.className = "nx-spacer"
        c.$bulkbar.replaceChildren(
            label,
            button({ iconName: "pencil", onclick: bulkEdit }, [text("edit"), "…"]),
            button({ variant: "danger", iconName: "trash", onclick: bulkDelete }, [text("delete")]),
            spacer,
            button({ variant: "icon", iconName: "x-lg", title: "Clear selection", onclick: () => selection.clear() })
        )
    }

    // bulk edit: pick ONE field, set ONE value, applied to every selected row
    function bulkEdit() {
        const fields = editableFields(s)
        const picker = document.createElement("select")
        picker.className = "nx-input"
        for (const f of fields) {
            const option = document.createElement("option")
            option.value = f.name
            option.textContent = f.label?.en ?? f.name
            picker.append(option)
        }
        const slot = document.createElement("div")
        slot.className = "nx-field"
        let value
        const mountValue = () => {
            const f = fields.find((x) => x.name === picker.value)
            value = f.type === "boolean" ? false : null
            slot.replaceChildren((interfaces[f.type] ?? interfaces.text)(f, undefined, (v) => (value = v)))
        }
        picker.addEventListener("change", mountValue)
        mountValue()
        const fieldWrap = document.createElement("div")
        fieldWrap.className = "nx-field"
        const fieldLabel = document.createElement("label")
        fieldLabel.className = "nx-label"
        fieldLabel.textContent = "Field"
        fieldWrap.append(fieldLabel, picker)
        const actions = document.createElement("div")
        actions.className = "nx-actions"
        actions.append(button({
            variant: "primary",
            onclick: async () => {
                let ok = 0
                for (const id of selection.ids) {
                    const r = await ctx.api.update(s.name, id, { [picker.value]: value })
                    if (r.ok) ok++
                }
                ctx.closeDrawer()
                toast(ok + "/" + selection.size + " records updated")
                selection.clear()
                refresh()
            }
        }, [text("save")]))
        const body = document.createElement("div")
        body.append(fieldWrap, slot, actions)
        ctx.drawer(ctx.i18n.resolve("edit") + " " + selection.size + " · " + s.name, body)
    }

    async function bulkDelete() {
        if (!(await confirmDialog(ctx.i18n.resolve("delete") + " " + selection.size + " records?"))) return
        let ok = 0
        for (const id of selection.ids) {
            const r = await ctx.api.remove(s.name, id)
            if (r.ok) ok++
        }
        toast(ok + "/" + selection.size + " records deleted")
        selection.clear()
        refresh()
    }

    function openCreate() {
        ctx.drawer(ctx.i18n.resolve("newRecord") + " · " + s.name, buildForm(s, {
            submitLabel: ctx.i18n.resolve("save"),
            locale: ctx.i18n.locale,
            onSubmit: async (values) => {
                const r = await ctx.api.create(s.name, values)
                if (!r.ok) return toast(r.error.code + ": " + (r.error.message || ""), "err")
                ctx.closeDrawer()
                toast("Record created")
                refresh()
            }
        }))
    }

    function openEdit(row) {
        const form = buildForm(s, {
            data: row,
            submitLabel: ctx.i18n.resolve("save"),
            locale: ctx.i18n.locale,
            onSubmit: async (values) => {
                const { id, owner, created_at, updated_at, ...data } = values
                const r = await ctx.api.update(s.name, row.id, data)
                if (!r.ok) return toast(r.error.code + ": " + (r.error.message || ""), "err")
                ctx.closeDrawer()
                toast("Record saved")
                refresh()
            }
        })
        form.querySelector(".nx-actions").append(button({
            variant: "danger", iconName: "trash",
            onclick: async () => {
                if (!(await confirmDialog(ctx.i18n.resolve("delete") + " " + row.id + "?"))) return
                const r = await ctx.api.remove(s.name, row.id)
                if (!r.ok) return toast(r.error.code + ": " + (r.error.message || ""), "err")
                ctx.closeDrawer()
                toast("Record deleted")
                refresh()
            }
        }, [text("delete")]))
        const meta = document.createElement("div")
        meta.setAttribute("style", "margin-bottom:0.75rem;display:flex;flex-direction:column;gap:0.125rem")
        for (const [label, value] of [["id      ", row.id], ["owner   ", row.owner], ["created ", (row.created_at ?? "").replace("T", " ").slice(0, 19)], ["updated ", (row.updated_at ?? "").replace("T", " ").slice(0, 19)]]) {
            const line = document.createElement("div")
            line.className = "nx-pub"
            line.textContent = label + "  " + (value ?? "—")
            meta.append(line)
        }
        const body = document.createElement("div")
        body.append(meta, form)
        ctx.drawer(s.name + " · " + row.id.slice(0, 10) + "…", body)
    }

    function emptyState() {
        const empty = document.createElement("div")
        empty.className = "nx-empty"
        const mark = document.createElement("div")
        mark.innerHTML = hexSVG(44)
        const line = document.createElement("div")
        line.textContent = "No " + s.name + " records yet"
        const cta = button({ variant: "primary", iconName: "plus-lg", onclick: openCreate }, [text("newRecord")])
        cta.style.marginTop = "0.75rem"
        empty.append(mark, line, cta)
        return empty
    }

    // render the ACTIVE view from the registry — list, kanban, … same contract
    function paintRows(rows) {
        currentRows = rows
        c.$count.dataset.args = JSON.stringify([rows.length])
        if (!rows.length) return c.$results.replaceChildren(emptyState())
        const view = VIEWS.find((v) => v.id === viewId && v.available(s)) ?? VIEWS[0]
        c.$results.replaceChildren(view.render({
            schema: s, rows, selection,
            onRow: openEdit,
            onMove: async (row, field, value) => {
                const r = await ctx.api.update(s.name, row.id, { [field]: value })
                if (!r.ok) return toast(r.error.code, "err")
                refresh()
            }
        }))
        selection.repaint = () => paintRows(currentRows)
    }

    async function refresh(rows) {
        c.$error.textContent = ""
        if (!rows) {
            c.$filterInfo.textContent = ""
            // offline-first (akao DB.js thinking): last-known rows paint NOW…
            const held = await cached("rows:" + s.name)
            if (held?.length) paintRows(held)
            try {
                // …then the network revalidates and replaces
                const r = await ctx.api.list(s.name, null)
                if (!r.ok) { c.$error.textContent = r.error.code; if (!held) paintRows([]); return }
                rows = r.data
                remember("rows:" + s.name, rows)
            } catch {
                if (held?.length) { toast("Offline — showing cached data", "err"); return }
                c.$error.textContent = "Offline — no cached data yet"
                return
            }
        }
        paintRows(rows)
    }

    function show(rows, info) {
        c.$filterInfo.textContent = info
        if (!rows.length) {
            currentRows = []
            c.$count.dataset.args = "[0]"
            const none = document.createElement("div")
            none.className = "nx-empty"
            none.textContent = "No rows match"
            c.$results.replaceChildren(none)
            return
        }
        paintRows(rows)
    }

    // One box, two readings: a parseable expression runs as a FILTER (NL→AST);
    // anything else falls back to relevance-ranked SEARCH — never an error for
    // ordinary words (the Frappe awesomebar habit).
    async function runAsk(q) {
        if (!q.trim()) { refresh(); return }
        c.$error.textContent = ""
        const r = await ctx.api.ask(s.name, q)
        if (r.ok) {
            const data = Array.isArray(r.data) ? { rows: r.data } : r.data
            return show(data.rows || [], data.filter?.root ? "filter: " + JSON.stringify(data.filter.root) : "")
        }
        if ((r.error.code || "").startsWith("E_NL")) {
            const sr = await ctx.api.search(s.name, q)
            if (!sr.ok) { c.$error.textContent = sr.error.code + ": " + (sr.error.message || ""); return }
            return show((sr.data || []).map((h) => h.row), 'search "' + q + '" — ranked by relevance')
        }
        c.$error.textContent = r.error.code + ": " + (r.error.message || "")
    }

    // The visual Query AST builder — unlimited AND/OR/NOT nesting, the same
    // component that edits permission row rules. Frappe's rule, made recursive:
    // only conditions WITH a value constrain the query (activeFilter); a fresh
    // or half-typed condition is "pending" and never blanks the list.
    const builder = document.createElement("nx-query-builder")
    builder.schema = s
    let filterTimer = null
    builder.addEventListener("change", (e) => {
        if (!e.detail.valid) return
        clearTimeout(filterTimer)
        filterTimer = setTimeout(async () => {
            const edited = e.detail.value.root
            const active = activeFilter(edited)
            const total = countLeaves(edited)
            const pending = total - countLeaves(active)
            c.$filterCount.textContent = countLeaves(active) ? " · " + countLeaves(active) : ""
            const document_ = active ? { astVersion: 1, root: active } : null
            const r = await ctx.api.list(s.name, document_)
            if (!r.ok) { c.$error.textContent = r.error.code + ": " + (r.error.message || ""); return }
            c.$error.textContent = ""
            const note = active ? "filter: " + JSON.stringify(active) : ""
            show(r.data, note + (pending ? (note ? " · " : "") + pending + " pending — type a value" : ""))
        }, 250)
    })
    c.$filterCard.append(builder)

    // view switcher — every registered view whose availability the schema meets
    c.$switcher.replaceChildren(...VIEWS.filter((v) => v.available(s)).map((v) =>
        button({
            variant: v.id === viewId ? "primary" : "icon", iconName: v.icon, title: v.label,
            onclick: () => {
                viewId = v.id
                localStorage.setItem("nexus-view-" + s.name, viewId)
                ctx.navigate("content", s.name)
            }
        })
    ))

    refresh()
    return host
}
