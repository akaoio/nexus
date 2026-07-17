/** /permissions route — logic: loads the CURRENT policy set into
 *  <nx-permission-manager>, feeds the <nx-matrix> verdict live, saves +
 *  hot-applies (no restart). In DEV mode it says, honestly, that policies
 *  are not enforced yet. */

import { mountTemplate, toast } from "../../kit.js"
import "../../components/matrix/index.js"
import { permissionsTemplate } from "./template.js"

export function render(ctx) {
    const mgr = document.createElement("nx-permission-manager")
    mgr.schemas = ctx.schemas
    const matrix = document.createElement("nx-matrix")

    const c = {}
    const host = mountTemplate(permissionsTemplate(c, {
        onSave: async () => {
            const r = await ctx.api.studio("permissions", "POST", { policies: mgr.value })
            toast(r.ok ? "Policies saved & applied" : r.error.code + ": " + (r.error.message || ""), r.ok ? "ok" : "err")
            if (r.ok) load()
        }
    }))
    c.$matrix.append(matrix)
    c.$manager.append(mgr)
    mgr.addEventListener("change", (e) => (matrix.policies = e.detail.value))

    async function load() {
        const r = await ctx.api.studio("permissions", "GET")
        if (!r.ok) return
        mgr.value = r.data.policies
        matrix.policies = r.data.policies
        c.$status.textContent = r.data.live + " live"
        c.$banner.replaceChildren()
        if (r.data.devMode) {
            const card = document.createElement("div")
            card.className = "nx-card"
            card.style.borderLeft = "0.1875rem solid var(--accent)"
            const b = document.createElement("b")
            b.textContent = "DEV mode — policies are not enforced yet."
            const span = document.createElement("span")
            span.className = "nx-muted"
            span.textContent = " Without identities every request runs as the wide-open DEV admin, so nothing is denied. Add an identity in Users (e.g. “Add me as admin”) to turn authentication on — from that moment these policies decide who can do what."
            card.append(b, document.createElement("br"), span)
            c.$banner.append(card)
        }
    }
    load()
    return host
}
