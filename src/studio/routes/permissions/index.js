/** /permissions route — logic: loads the CURRENT policy set into
 *  <nx-permission-manager>, feeds the <nx-matrix> verdict live, saves +
 *  hot-applies (no restart). In DEV mode it says, honestly, that policies
 *  are not enforced yet. */

import { mountTemplate, toast } from "../../kit/index.js"
import "../../components/matrix/index.js"
import { rolesIn } from "../../../core/App/policies.js"
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
    mgr.addEventListener("change", (e) => {
        matrix.policies = e.detail.value
        paintRoles(e.detail.value)
    })

    let identities = []
    /** The roles overview — each role is a BUNDLE: n policies grant through it, n users hold it. */
    function paintRoles(policies) {
        const overview = rolesIn(policies, identities)
        c.$roles.replaceChildren()
        if (!overview.length) {
            const none = document.createElement("p")
            none.className = "nx-muted"
            none.textContent = "No roles yet — every policy below applies to all authenticated users."
            return c.$roles.append(none)
        }
        for (const r of overview) {
            const card = document.createElement("span")
            card.className = "nx-rolecard"
            const name = document.createElement("strong")
            name.textContent = r.role
            const spec = document.createElement("span")
            spec.className = "nx-muted"
            spec.textContent = `${r.policies} ${r.policies === 1 ? "policy" : "policies"} · ${r.users} ${r.users === 1 ? "user" : "users"}`
            card.append(name, spec)
            if (!r.policies) card.title = "Held by users but granting nothing — attach it to a policy below"
            if (!r.users) card.title = "Grants policies but nobody holds it — assign it in Users"
            c.$roles.append(card)
        }
    }

    async function load() {
        const [r, u] = await Promise.all([ctx.api.studio("permissions", "GET"), ctx.api.studio("users", "GET")])
        if (!r.ok) return
        identities = u.ok ? u.data.identities : []
        mgr.value = r.data.policies
        matrix.policies = r.data.policies
        paintRoles(r.data.policies)
        c.$status.textContent = r.data.live + " live"
        c.$banner.replaceChildren()
        if (r.data.devMode) {
            const card = document.createElement("div")
            card.className = "nx-card nx-note"
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
