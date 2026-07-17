/** /permissions route — logic: loads the CURRENT policy set into
 *  <nx-permission-manager>, renders the Role×Entity×Action matrix live,
 *  saves + hot-applies (no restart). In DEV mode it says, honestly, that
 *  policies are not enforced yet. */

import { mountTemplate, toast } from "../../lib.js"
import { permissionsTemplate } from "./template.js"

const cell = (tag, props = {}, children = []) => {
    const node = document.createElement(tag)
    if (props.className) node.className = props.className
    if (props.text != null) node.textContent = props.text
    if (props.style) node.setAttribute("style", props.style)
    node.append(...[].concat(children).filter(Boolean))
    return node
}

export function render(ctx) {
    const mgr = document.createElement("nx-permission-manager")
    mgr.schemas = ctx.schemas

    const c = {}
    const host = mountTemplate(permissionsTemplate(c, {
        onSave: async () => {
            const r = await ctx.api.studio("permissions", "POST", { policies: mgr.value })
            toast(r.ok ? "Policies saved & applied" : r.error.code + ": " + (r.error.message || ""), r.ok ? "ok" : "err")
            if (r.ok) load()
        }
    }))
    c.$manager.append(mgr)

    // The Frappe-style verdict at a glance: Role × Entity × Actions, with the
    // row-level rule and the column level (permlevel) each policy carries.
    function renderMatrix(policies) {
        c.$matrix.replaceChildren(cell("h3", {
            className: "", text: "Role × Entity × Action",
            style: "margin:0 0 0.625rem;font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.07em;color:var(--muted)"
        }))
        if (!policies.length) {
            c.$matrix.append(cell("p", { className: "nx-muted", text: "No policies yet — deny-by-default: with auth on, a user can do nothing until a policy grants it. Add one below." }))
            return
        }
        const table = cell("table", { className: "nx-table" })
        table.append(cell("thead", {}, [cell("tr", {}, ["role", "entity", "actions", "rows (rule)", "columns (permlevel)"].map((h) => cell("th", { text: h })))]))
        const body = cell("tbody")
        for (const p of policies) {
            body.append(cell("tr", {}, [
                cell("td", {}, [cell("span", { className: "nx-chip accent", text: (p.roles ?? []).join(", ") || "any signed-in" })]),
                cell("td", { className: "mono", text: p.entity }),
                cell("td", {}, (p.actions ?? []).map((a) => cell("span", { className: "nx-chip", style: "margin-right:0.25rem", text: a }))),
                cell("td", { className: "mono", text: p.rule ? JSON.stringify(p.rule.root) : "all rows" + (p.ifOwner ? " · own only" : "") }),
                cell("td", { className: "num", text: "level ≤ " + (p.permlevel ?? 0) })
            ]))
        }
        table.append(body)
        c.$matrix.append(cell("div", { style: "overflow-x:auto" }, [table]))
        c.$matrix.append(cell("p", {
            className: "nx-muted", style: "font-size:var(--text-sm);margin:0.5rem 0 0",
            text: "Rows: the rule is a Query AST — the same unlimited-depth builder as everywhere. Columns: fields with a higher permlevel than the policy grants are invisible and unfilterable (Frappe permlevel 0–9)."
        }))
    }
    mgr.addEventListener("change", (e) => renderMatrix(e.detail.value))

    async function load() {
        const r = await ctx.api.studio("permissions", "GET")
        if (!r.ok) return
        mgr.value = r.data.policies
        renderMatrix(r.data.policies)
        c.$status.textContent = r.data.live + " live"
        c.$banner.replaceChildren()
        if (r.data.devMode) {
            const card = cell("div", { className: "nx-card", style: "border-left:0.1875rem solid var(--accent)" }, [
                cell("b", { text: "DEV mode — policies are not enforced yet." }),
                cell("br"),
                cell("span", { className: "nx-muted", text: "Without identities every request runs as the wide-open DEV admin, so nothing is denied. Add an identity in Users (e.g. “Add me as admin”) to turn authentication on — from that moment these policies decide who can do what." })
            ])
            c.$banner.append(card)
        }
    }
    load()
    return host
}
