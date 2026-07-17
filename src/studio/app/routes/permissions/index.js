/** Permissions module — the role×Entity×action matrix (<nx-permission-manager>,
 *  which embeds <nx-query-builder> for row rules). Loads the CURRENT policy
 *  set, saves it back and hot-applies — no restart. In DEV mode (no
 *  identities) it says, honestly, that policies are not enforced yet. */
import { el } from "../../lib.js"

export function render(ctx) {
    const mgr = el("nx-permission-manager")
    mgr.schemas = ctx.schemas
    const banner = el("div")
    const status = el("span", { class: "nx-muted" })

    async function load() {
        const r = await ctx.api.studio("permissions", "GET")
        if (!r.ok) return
        mgr.value = r.data.policies
        renderMatrix(r.data.policies)
        status.textContent = r.data.live + " live"
        banner.replaceChildren()
        if (r.data.devMode)
            banner.append(el("div", {
                class: "nx-card", style: "border-left:3px solid var(--accent)",
                html: `<b>DEV mode — policies are not enforced yet.</b><br>
                <span class="nx-muted">Without identities every request runs as the wide-open DEV admin, so nothing is denied.
                Add an identity in <b>Users</b> (e.g. “Add me as admin”) to turn authentication on — from that moment these policies decide who can do what.</span>`
            }))
    }

    // The Frappe-style verdict at a glance: Role × Entity × Actions, with the
    // row-level rule and the column level (permlevel) each policy carries.
    const matrix = el("div", { class: "nx-card" })
    function renderMatrix(policies) {
        matrix.replaceChildren(el("h3", { style: "margin:0 0 10px;font-size:var(--text-xs);text-transform:uppercase;letter-spacing:.07em;color:var(--muted)", text: "Role × Entity × Action" }))
        if (!policies.length) {
            matrix.append(el("p", { class: "nx-muted", text: "No policies yet — deny-by-default: with auth on, a user can do nothing until a policy grants it. Add one below." }))
            return
        }
        const table = el("table", { class: "nx-table" })
        table.append(el("thead", {}, [el("tr", {}, ["role", "entity", "actions", "rows (rule)", "columns (permlevel)"].map((h) => el("th", { text: h })))]))
        const body = el("tbody")
        for (const p of policies) {
            body.append(el("tr", {}, [
                el("td", {}, [el("span", { class: "nx-chip accent", text: (p.roles ?? []).join(", ") || "any signed-in" })]),
                el("td", { class: "mono", text: p.entity }),
                el("td", {}, (p.actions ?? []).map((a) => el("span", { class: "nx-chip", style: "margin-right:4px", text: a }))),
                el("td", { class: "mono", text: p.rule ? JSON.stringify(p.rule.root) : "all rows" + (p.ifOwner ? " · own only" : "") }),
                el("td", { class: "num", text: "level ≤ " + (p.permlevel ?? 0) })
            ]))
        }
        table.append(body)
        matrix.append(el("div", { style: "overflow-x:auto" }, [table]))
        matrix.append(el("p", { class: "nx-muted", style: "font-size:var(--text-sm);margin:8px 0 0", text: "Rows: the rule is a Query AST — the same unlimited-depth builder as everywhere. Columns: fields with a higher permlevel than the policy grants are invisible and unfilterable (Frappe permlevel 0–9)." }))
    }
    mgr.addEventListener("change", (e) => renderMatrix(e.detail.value))

    const save = el("button", {
        class: "nx-btn primary", text: ctx.t("savePolicies"),
        onclick: async () => {
            const r = await ctx.api.studio("permissions", "POST", { policies: mgr.value })
            ctx.toast(r.ok ? "Policies saved & applied" : r.error.code + ": " + (r.error.message || ""), r.ok ? "ok" : "err")
            if (r.ok) load()
        }
    })
    load()
    return el("div", {}, [
        el("div", { class: "nx-head" }, [el("h1", { text: ctx.t("permissions") }), status, el("span", { class: "nx-spacer" }), save]),
        banner,
        matrix,
        el("div", { class: "nx-card" }, [mgr])
    ])
}
