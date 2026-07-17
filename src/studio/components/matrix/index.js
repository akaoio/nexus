/**
 * <nx-matrix> — the Frappe-style permission verdict at a glance: one row per
 * policy showing role, entity, actions, the ROW rule (Query AST) and the
 * COLUMN level (permlevel). `.policies` in, table out; a pure display
 * component the permissions route feeds live.
 */

import { render } from "../../../core/UI.js"
import { matrixTemplate } from "./template.js"

export class NxMatrix extends HTMLElement {
    #policies = []

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        render(matrixTemplate(this), this.shadowRoot)
    }

    set policies(next) {
        this.#policies = Array.isArray(next) ? next : []
        this.paint()
    }

    get policies() {
        return this.#policies
    }

    connectedCallback() {
        this.paint()
    }

    paint() {
        if (!this.$body) return
        this.$body.replaceChildren()
        if (!this.#policies.length) {
            const p = document.createElement("p")
            p.className = "empty"
            p.textContent = "No policies yet — deny-by-default: with auth on, a user can do nothing until a policy grants it. Add one below."
            this.$body.append(p)
            return
        }
        const scroll = document.createElement("div")
        scroll.className = "scroll"
        const table = document.createElement("table")
        const thead = document.createElement("thead")
        const headRow = document.createElement("tr")
        for (const h of ["role", "entity", "actions", "rows (rule)", "columns (permlevel)"]) {
            const th = document.createElement("th")
            th.textContent = h
            headRow.append(th)
        }
        thead.append(headRow)
        const tbody = document.createElement("tbody")
        for (const p of this.#policies) {
            const tr = document.createElement("tr")
            const role = document.createElement("td")
            const roleChip = document.createElement("span")
            roleChip.className = "chip accent"
            roleChip.textContent = (p.roles ?? []).join(", ") || "any signed-in"
            role.append(roleChip)
            const entity = document.createElement("td")
            entity.className = "mono"
            entity.textContent = p.entity
            const actions = document.createElement("td")
            for (const a of p.actions ?? []) {
                const chip = document.createElement("span")
                chip.className = "chip"
                chip.textContent = a
                actions.append(chip)
            }
            const rule = document.createElement("td")
            rule.className = "mono"
            rule.textContent = p.rule ? JSON.stringify(p.rule.root) : "all rows" + (p.ifOwner ? " · own only" : "")
            const level = document.createElement("td")
            level.className = "num"
            level.textContent = "level ≤ " + (p.permlevel ?? 0)
            tr.append(role, entity, actions, rule, level)
            tbody.append(tr)
        }
        table.append(thead, tbody)
        scroll.append(table)
        const note = document.createElement("p")
        note.className = "note"
        note.textContent = "Rows: the rule is a Query AST — the same unlimited-depth builder as everywhere. Columns: fields with a higher permlevel than the policy grants are invisible and unfilterable (Frappe permlevel 0–9)."
        this.$body.append(scroll, note)
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-matrix")) customElements.define("nx-matrix", NxMatrix)

export default NxMatrix
