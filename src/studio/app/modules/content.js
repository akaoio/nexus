/**
 * Content module — browse and create records of an Entity. The list and the
 * create form are GENERATED from the Entity schema (fields.js), plus NL→AST
 * "Ask". No per-Entity code.
 */

import { el } from "../lib.js"
import { buildList, buildForm } from "../fields.js"

export function render(ctx) {
    const s = ctx.schemas.find((x) => x.name === ctx.state.entity)
    if (!s) return el("div", { class: "nx-empty", text: "No Entity selected" })

    const count = el("span", { class: "nx-muted" })
    const results = el("div")
    const error = el("div", { class: "nx-err" })

    const openForm = () =>
        ctx.drawer(ctx.t("newRecord") + " · " + s.name, buildForm(s, {
            submitLabel: ctx.t("save"),
            onSubmit: async (values) => {
                const r = await ctx.api.create(s.name, values)
                if (!r.ok) return ctx.toast(r.error.code + ": " + (r.error.message || ""), "err")
                ctx.closeDrawer(); ctx.toast("Record created"); refresh()
            }
        }))

    function emptyState() {
        return el("div", { class: "nx-empty" }, [
            el("div", { class: "big", text: "▤" }),
            el("div", { text: "No " + s.name + " records yet" }),
            el("button", { class: "nx-btn primary", style: "margin-top:12px", text: "＋ " + ctx.t("newRecord"), onclick: openForm })
        ])
    }

    async function refresh(rows) {
        error.textContent = ""
        if (!rows) { const r = await ctx.api.list(s.name, null); if (!r.ok) { error.textContent = r.error.code; rows = [] } else rows = r.data }
        count.textContent = rows.length + " " + ctx.t("records")
        results.replaceChildren(rows.length ? buildList(s, rows) : emptyState())
    }

    async function runAsk(q) {
        if (!q.trim()) return
        const r = await ctx.api.ask(s.name, q)
        if (!r.ok) { error.textContent = r.error.code + ": " + (r.error.message || ""); return }
        refresh(Array.isArray(r.data) ? r.data : r.data.rows || [])
    }

    const ask = el("input", { class: "nx-input", placeholder: ctx.t("ask") + "… e.g. done = false", onkeydown: (e) => { if (e.key === "Enter") runAsk(e.target.value) } })
    refresh()
    return el("div", {}, [
        el("div", { class: "nx-head" }, [el("h1", { text: s.name }), count, el("span", { class: "nx-spacer" }), el("button", { class: "nx-btn primary", text: "＋ " + ctx.t("newRecord"), onclick: openForm })]),
        el("div", { class: "nx-card" }, [ask]),
        error,
        results
    ])
}
