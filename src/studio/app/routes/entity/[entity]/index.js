/**
 * Content module — browse, create, EDIT and DELETE records of an Entity. The
 * list and the forms are GENERATED from the Entity schema (fields.js), plus
 * NL→AST "Ask" with the parsed filter shown honestly. No per-Entity code.
 */

import { el, icon } from "../../../lib.js"
import { buildForm, editableFields, interfaces } from "../../../fields.js"
import { hexSVG } from "../../../../css/elements/bits.css.js"
import { activeFilter } from "../../../../components/query-builder/index.js"
import { createSelection } from "../../../selection.js"
import { cached, remember } from "../../../cache.js"
import { VIEWS } from "../../../views/index.js"

const countLeaves = (node) => (!node ? 0 : node.field ? 1 : node.children.reduce((n, c) => n + countLeaves(c), 0))

export function render(ctx) {
    const s = ctx.schemas.find((x) => x.name === ctx.state.entity)
    if (!s) return el("div", { class: "nx-empty", text: "No Entity selected" })

    const count = el("span", { class: "nx-muted" })
    const results = el("div")
    const error = el("div", { class: "nx-err" })
    const filterInfo = el("div", { class: "nx-muted", style: "font-family:var(--mono);font-size:var(--text-sm);margin-top:6px" })
    const bulkbar = el("div", { class: "nx-bulkbar", hidden: true })
    let currentRows = []
    let viewId = localStorage.getItem("nexus-view-" + s.name) || "list"

    // the pure selection model — every view paints from it (SEL-* clauses)
    const selection = createSelection(() => {
        paintBulkbar()
        selection.repaint?.()
    })

    function paintBulkbar() {
        bulkbar.hidden = selection.size === 0
        if (bulkbar.hidden) return
        bulkbar.replaceChildren(
            el("b", { text: selection.size + " selected" }),
            el("button", { class: "nx-btn", onclick: bulkEdit }, [icon("pencil"), document.createTextNode(ctx.t("edit", "Edit") + "…")]),
            el("button", { class: "nx-btn danger", onclick: bulkDelete }, [icon("trash"), document.createTextNode(ctx.t("delete", "Delete"))]),
            el("span", { class: "nx-spacer" }),
            el("button", { class: "nx-btn icon", title: "Clear selection", onclick: () => selection.clear() }, [icon("x-lg")])
        )
    }

    // bulk edit: pick ONE field, set ONE value, applied to every selected row
    function bulkEdit() {
        const fields = editableFields(s)
        const picker = el("select", { class: "nx-input" }, fields.map((f) => el("option", { value: f.name, text: f.label?.en ?? f.name })))
        const slot = el("div", { class: "nx-field" })
        let value
        const mountValue = () => {
            const f = fields.find((x) => x.name === picker.value)
            value = f.type === "boolean" ? false : null
            slot.replaceChildren((interfaces[f.type] ?? interfaces.text)(f, undefined, (v) => (value = v)))
        }
        picker.addEventListener("change", mountValue)
        mountValue()
        const apply = el("button", {
            class: "nx-btn primary", text: ctx.t("save"),
            onclick: async () => {
                let ok = 0
                for (const id of selection.ids) {
                    const r = await ctx.api.update(s.name, id, { [picker.value]: value })
                    if (r.ok) ok++
                }
                ctx.closeDrawer()
                ctx.toast(ok + "/" + selection.size + " records updated")
                selection.clear()
                refresh()
            }
        })
        ctx.drawer(ctx.t("edit", "Edit") + " " + selection.size + " · " + s.name, el("div", {}, [
            el("div", { class: "nx-field" }, [el("label", { class: "nx-label", text: "Field" }), picker]),
            slot,
            el("div", { class: "nx-actions" }, [apply])
        ]))
    }

    async function bulkDelete() {
        if (!confirm(ctx.t("delete", "Delete") + " " + selection.size + " records?")) return
        let ok = 0
        for (const id of selection.ids) {
            const r = await ctx.api.remove(s.name, id)
            if (r.ok) ok++
        }
        ctx.toast(ok + "/" + selection.size + " records deleted")
        selection.clear()
        refresh()
    }

    const openCreate = () =>
        ctx.drawer(ctx.t("newRecord") + " · " + s.name, buildForm(s, {
            submitLabel: ctx.t("save"),
            locale: ctx.i18n.locale,
            onSubmit: async (values) => {
                const r = await ctx.api.create(s.name, values)
                if (!r.ok) return ctx.toast(r.error.code + ": " + (r.error.message || ""), "err")
                ctx.closeDrawer(); ctx.toast("Record created"); refresh()
            }
        }))

    const openEdit = (row) => {
        const form = buildForm(s, {
            data: row,
            submitLabel: ctx.t("save"),
            locale: ctx.i18n.locale,
            onSubmit: async (values) => {
                const { id, owner, created_at, updated_at, ...data } = values
                const r = await ctx.api.update(s.name, row.id, data)
                if (!r.ok) return ctx.toast(r.error.code + ": " + (r.error.message || ""), "err")
                ctx.closeDrawer(); ctx.toast("Record saved"); refresh()
            }
        })
        const del = el("button", {
            class: "nx-btn danger", type: "button", text: ctx.t("delete", "Delete"),
            onclick: async () => {
                if (!confirm(ctx.t("delete", "Delete") + " " + row.id + "?")) return
                const r = await ctx.api.remove(s.name, row.id)
                if (!r.ok) return ctx.toast(r.error.code + ": " + (r.error.message || ""), "err")
                ctx.closeDrawer(); ctx.toast("Record deleted"); refresh()
            }
        })
        form.querySelector(".nx-actions").append(del)
        const meta = (label, value) => el("div", { class: "nx-pub", text: label + "  " + (value ?? "—") })
        ctx.drawer(s.name + " · " + row.id.slice(0, 10) + "…", el("div", {}, [
            el("div", { style: "margin-bottom:12px;display:flex;flex-direction:column;gap:2px" }, [
                meta("id      ", row.id),
                meta("owner   ", row.owner),
                meta("created ", (row.created_at ?? "").replace("T", " ").slice(0, 19)),
                meta("updated ", (row.updated_at ?? "").replace("T", " ").slice(0, 19))
            ]),
            form
        ]))
    }

    function emptyState() {
        return el("div", { class: "nx-empty" }, [
            el("div", { html: hexSVG(44) }),
            el("div", { text: "No " + s.name + " records yet" }),
            el("button", { class: "nx-btn primary", style: "margin-top:0.75rem", onclick: openCreate }, [icon("plus-lg"), document.createTextNode(ctx.t("newRecord"))])
        ])
    }

    // render the ACTIVE view from the registry — list, kanban, … same contract
    function paintRows(rows) {
        currentRows = rows
        count.textContent = rows.length + " " + ctx.t("records")
        if (!rows.length) return results.replaceChildren(emptyState())
        const view = VIEWS.find((v) => v.id === viewId && v.available(s)) ?? VIEWS[0]
        results.replaceChildren(view.render({
            schema: s, rows, selection,
            onRow: openEdit,
            onMove: async (row, field, value) => {
                const r = await ctx.api.update(s.name, row.id, { [field]: value })
                if (!r.ok) return ctx.toast(r.error.code, "err")
                refresh()
            }
        }))
        selection.repaint = () => paintRows(currentRows)
    }

    async function refresh(rows) {
        error.textContent = ""
        if (!rows) {
            filterInfo.textContent = ""
            // offline-first (akao DB.js thinking): last-known rows paint NOW…
            const held = await cached("rows:" + s.name)
            if (held?.length) paintRows(held)
            try {
                // …then the network revalidates and replaces
                const r = await ctx.api.list(s.name, null)
                if (!r.ok) { error.textContent = r.error.code; if (!held) paintRows([]); return }
                rows = r.data
                remember("rows:" + s.name, rows)
            } catch {
                if (held?.length) { ctx.toast("Offline — showing cached data", "err"); return }
                error.textContent = "Offline — no cached data yet"
                return
            }
        }
        paintRows(rows)
    }

    function show(rows, info) {
        filterInfo.textContent = info
        if (!rows.length) {
            currentRows = []
            count.textContent = "0 " + ctx.t("records")
            results.replaceChildren(el("div", { class: "nx-empty", text: "No rows match" }))
            return
        }
        paintRows(rows)
    }

    // One box, two readings: a parseable expression runs as a FILTER (NL→AST);
    // anything else falls back to relevance-ranked SEARCH — never an error for
    // ordinary words (the Frappe awesomebar habit).
    async function runAsk(q) {
        if (!q.trim()) { refresh(); return }
        error.textContent = ""
        const r = await ctx.api.ask(s.name, q)
        if (r.ok) {
            const data = Array.isArray(r.data) ? { rows: r.data } : r.data
            return show(data.rows || [], data.filter?.root ? "filter: " + JSON.stringify(data.filter.root) : "")
        }
        if ((r.error.code || "").startsWith("E_NL")) {
            const sr = await ctx.api.search(s.name, q)
            if (!sr.ok) { error.textContent = sr.error.code + ": " + (sr.error.message || ""); return }
            return show((sr.data || []).map((h) => h.row), 'search "' + q + '" — ranked by relevance')
        }
        error.textContent = r.error.code + ": " + (r.error.message || "")
    }

    const ask = el("input", {
        class: "nx-input", style: "flex:1;width:auto",
        placeholder: ctx.t("ask") + '… e.g. done = false, "chưa xong", due < today',
        onkeydown: (e) => { if (e.key === "Enter") runAsk(e.target.value) }
    })
    const clear = el("button", {
        class: "nx-btn icon", title: "Clear",
        onclick: () => { ask.value = ""; builder.value = null; refresh() }
    }, [icon("x-lg")])

    // The visual Query AST builder — unlimited AND/OR/NOT nesting, the same
    // component that edits permission row rules. Frappe's rule, made recursive:
    // only conditions WITH a value constrain the query (activeFilter); a fresh
    // or half-typed condition is "pending" and never blanks the list. Edits
    // re-query after a 250ms breath.
    const builder = el("nx-query-builder")
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
            filterLabel.textContent = ctx.t("filter", "Filter") + (countLeaves(active) ? " · " + countLeaves(active) : "")
            const document_ = active ? { astVersion: 1, root: active } : null
            const r = await ctx.api.list(s.name, document_)
            if (!r.ok) { error.textContent = r.error.code + ": " + (r.error.message || ""); return }
            error.textContent = ""
            const note = active ? "filter: " + JSON.stringify(active) : ""
            show(r.data, note + (pending ? (note ? " · " : "") + pending + " pending — type a value" : ""))
        }, 250)
    })
    const filterCard = el("div", { class: "nx-card", hidden: true }, [builder])
    const filterLabel = el("span", { text: ctx.t("filter", "Filter") })
    const filterToggle = el("button", {
        class: "nx-btn",
        onclick: () => { filterCard.hidden = !filterCard.hidden }
    }, [icon("funnel"), filterLabel])

    // view switcher — every registered view whose availability the schema meets
    const switcher = el("div", { class: "nx-toolbar" }, VIEWS.filter((v) => v.available(s)).map((v) =>
        el("button", {
            class: "nx-btn icon" + (viewId === v.id ? " primary" : ""), title: v.label,
            onclick: () => {
                viewId = v.id
                localStorage.setItem("nexus-view-" + s.name, viewId)
                ctx.navigate("content", s.name) // re-render the module with the new view
            }
        }, [icon(v.icon)])
    ))

    refresh()
    return el("div", {}, [
        el("div", { class: "nx-head" }, [el("h1", { text: s.name }), count, el("span", { class: "nx-spacer" }), switcher, el("button", { class: "nx-btn primary", onclick: openCreate }, [icon("plus-lg"), document.createTextNode(ctx.t("newRecord"))])]),
        el("div", { class: "nx-card" }, [el("div", { class: "nx-toolbar" }, [ask, filterToggle, clear]), filterInfo]),
        filterCard,
        bulkbar,
        error,
        results
    ])
}
