/** /users route — the DIRECTORY: nexus_user rows through the ordinary
 *  entity API (system entities are just entities). Many roles per user
 *  (checkboxes over nexus_role) — the Frappe Has Role shape. WHO may edit
 *  WHOM is entirely the seeded policies' business ($CURRENT_USER rule for
 *  self-service, the admin bundle for everyone) — nothing here branches
 *  on a role name. */

import { mountTemplate, button, toast, confirmDialog, subscribe, onUnmount , buildForm, interfaces, parseTags } from "../../kit/index.js"
import "../../components/identicon/index.js"
import { usersTemplate } from "./template.js"

// One reader for a stored tag list, shared with the registry's `tags`
// interface. This used to be a bare JSON.parse: a roles value written by hand
// or by an older build threw inside load() and took the whole page down, where
// the honest answer is "no roles yet".
const parseRoles = (row) => parseTags(row.roles)

export function render(ctx) {
    const c = {}
    let roleNames = []
    const host = mountTemplate(usersTemplate(c, {
        onAddMe: addMe,
        onAdd: async () => {
            const pub = c.$pub.value.trim()
            if (!pub) return toast("A public key is required", "err")
            const r = await ctx.api.create("nexus_user", {
                pub,
                name: c.$name.value.trim() || pub,
                roles: JSON.stringify(c.$roles.value.split(",").map((s) => s.trim()).filter(Boolean))
            })
            if (!r.ok) return toast(r.error.code + ": " + (r.error.message || ""), "err")
            c.$pub.value = c.$name.value = c.$roles.value = ""
            toast("User added — live")
            load()
        }
    }))

    async function addMe() {
        const pass = prompt("Choose a passphrase for your admin identity (it derives your key — you will sign in with it):")
        if (!pass) return
        const { pair } = await ctx.deriveKeypair(pass)
        const r = await ctx.api.create("nexus_user", { pub: pair.pub, name: "admin", roles: JSON.stringify(["admin"]) })
        if (!r.ok) return toast(r.error.code, "err")
        toast("Admin added — authentication is now ON. Sign in with your passphrase.")
        setTimeout(() => location.reload(), 1200)
    }

    /**
     * The edit drawer, GENERATED from the nexus_user schema (§7.1: "sinh UI từ
     * schema"). This used to hand-build the whole form — a name/email/bio loop
     * plus a roles checklist — about twenty createElement calls of UI that no
     * other entity could reach and that the field registry could not see.
     *
     * `roles` is the one field the type registry cannot answer for: it is a
     * `text` column holding JSON, and Model Schema v1 is frozen (N4), so
     * "give it its own field type" is a format version rather than an
     * afternoon. The override seam points that ONE field at the registered
     * `tags` interface, so the widget stays reusable instead of inlined here.
     */
    function editUser(row) {
        const schema = ctx.schemas?.find((s) => s.name === "nexus_user")
        if (!schema) return toast("nexus_user schema unavailable", "err")

        const form = buildForm(schema, {
            data: row,
            submitLabel: "Save",
            // Only the fields a human edits here. `pub` is the identity itself
            // and changing it would mean a different person.
            fields: ["name", "email", "bio", "roles"],
            interfaces: { roles: (f, v, on) => interfaces.tags({ ...f, options: roleNames }, v, on) },
            onSubmit: async (values) => {
                // roles sits behind permlevel 1 (C1) — a non-admin sending it
                // at all throws E_FIELD_FORBIDDEN and takes the WHOLE save down
                // with it, even for an ordinary name/bio/email edit. This route
                // has no roles of its own to check (ctx carries no session), so
                // it asks the one place that already knows.
                const session = await ctx.api.session()
                const isAdmin = session.ok && (session.data.roles || []).includes("admin")
                const patch = { ...values }
                if (!isAdmin) delete patch.roles
                const r = await ctx.api.update("nexus_user", row.id, patch)
                toast(r.ok ? "Saved — live" : r.error.code + ": " + (r.error.message || ""), r.ok ? "ok" : "err")
                ctx.closeDrawer()
                load()
            }
        })

        const actions = document.createElement("div")
        actions.className = "nx-actions"
        actions.append(button({
            variant: "danger",
            onclick: async () => {
                if (!(await confirmDialog("Remove " + (row.name || row.pub) + "?"))) return
                const r = await ctx.api.remove("nexus_user", row.id)
                toast(r.ok ? "Removed" : r.error.code, r.ok ? "ok" : "err")
                ctx.closeDrawer()
                load()
            }
        }, ["Remove"]))
        form.prepend(actions)

        ctx.drawer(row.name || row.pub, form)
    }

    async function load() {
        const [users, roles] = await Promise.all([ctx.api.list("nexus_user", null), ctx.api.list("nexus_role", null)])
        const rows = users.ok ? users.data : []
        roleNames = [...new Set([
            ...(roles.ok ? roles.data.map((r) => r.name) : []),
            ...rows.flatMap(parseRoles)
        ])].sort()
        c.$banner.replaceChildren()
        if (!rows.length) {
            const card = document.createElement("div")
            card.className = "nx-card nx-note"
            card.textContent = "No users yet — every request runs as the wide-open DEV identity. Add yourself as admin to turn authentication on."
            c.$banner.append(card)
        }
        c.$list.replaceChildren()
        for (const row of rows) {
            const line = document.createElement("div")
            line.className = "nx-row"
            const avatar = document.createElement("nx-identicon")
            avatar.dataset.pub = row.pub
            const who = document.createElement("div")
            who.className = "nx-who"
            const name = document.createElement("div")
            name.textContent = row.name || row.pub
            const pub = document.createElement("div")
            pub.className = "nx-pub"
            pub.textContent = row.pub
            who.append(name, pub)
            const roleChips = document.createElement("span")
            roleChips.className = "nx-chip accent"
            roleChips.textContent = parseRoles(row).join(", ") || "no roles"
            const edit = button({ variant: "icon", iconName: "pencil", title: "Edit profile + roles", onclick: () => editUser(row) })
            line.append(avatar, who, roleChips, edit)
            c.$list.append(line)
        }
        if (!rows.length) c.$list.append(Object.assign(document.createElement("p"), { className: "nx-muted", textContent: "Nobody here yet." }))
    }
    load()

    // live refresh: coarse but truthful — re-run load() on any matching event
    let reloadTimer = null
    onUnmount(subscribe(["nexus_user", "nexus_role"], () => {
        clearTimeout(reloadTimer)
        reloadTimer = setTimeout(load, 250) // collapse bursts into one reload
    }))
    // the burst-collapse timer is a route resource too — the old
    // isConnected pattern was subscription-shaped and could not reach it,
    // so a timer scheduled just before navigating still fired on a dead route
    onUnmount(() => clearTimeout(reloadTimer))
    return host
}
