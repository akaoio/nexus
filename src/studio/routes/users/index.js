/** /users route — the DIRECTORY: nexus_user rows through the ordinary
 *  entity API (system entities are just entities). Many roles per user
 *  (checkboxes over nexus_role) — the Frappe Has Role shape. WHO may edit
 *  WHOM is entirely the seeded policies' business ($CURRENT_USER rule for
 *  self-service, the admin bundle for everyone) — nothing here branches
 *  on a role name. */

import { mountTemplate, button, toast, confirmDialog, subscribe } from "../../kit/index.js"
import "../../components/identicon/index.js"
import { usersTemplate } from "./template.js"

const parseRoles = (row) => (row.roles ? JSON.parse(row.roles) : [])

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

    /** The edit drawer: profile fields + the multi-role checklist. */
    function editUser(row) {
        const wrap = document.createElement("div")
        wrap.className = "nx-form"
        const values = { name: row.name ?? "", email: row.email ?? "", bio: row.bio ?? "" }
        for (const key of ["name", "email", "bio"]) {
            const field = document.createElement("div")
            field.className = "nx-field"
            const label = document.createElement("label")
            label.className = "nx-label"
            label.textContent = key
            const input = document.createElement("input")
            input.className = "nx-input"
            input.value = values[key]
            input.addEventListener("input", () => (values[key] = input.value))
            field.append(label, input)
            wrap.append(field)
        }
        const rolesWrap = document.createElement("div")
        rolesWrap.className = "nx-field"
        const rolesLabel = document.createElement("label")
        rolesLabel.className = "nx-label"
        rolesLabel.textContent = "roles — many per user"
        const grid = document.createElement("div")
        grid.className = "nx-options"
        const held = new Set(parseRoles(row))
        const boxFor = (name) => {
            const label = document.createElement("label")
            label.className = "nx-check"
            const box = document.createElement("input")
            box.type = "checkbox"
            box.checked = held.has(name)
            box.addEventListener("change", () => (box.checked ? held.add(name) : held.delete(name)))
            label.append(box, name)
            return label
        }
        for (const name of roleNames) grid.append(boxFor(name))
        const extra = document.createElement("input")
        extra.className = "nx-input"
        extra.placeholder = "new role name — Enter adds it"
        extra.addEventListener("keydown", (e) => {
            if (e.key !== "Enter" || !extra.value.trim()) return
            const name = extra.value.trim()
            held.add(name)
            grid.append(boxFor(name))
            grid.lastElementChild.querySelector("input").checked = true
            extra.value = ""
        })
        rolesWrap.append(rolesLabel, grid, extra)
        const actions = document.createElement("div")
        actions.className = "nx-actions"
        const remove = button({
            variant: "danger",
            onclick: async () => {
                if (!(await confirmDialog("Remove " + (row.name || row.pub) + "?"))) return
                const r = await ctx.api.remove("nexus_user", row.id)
                toast(r.ok ? "Removed" : r.error.code, r.ok ? "ok" : "err")
                ctx.closeDrawer()
                load()
            }
        }, ["Remove"])
        const spread = document.createElement("span")
        spread.className = "nx-spacer"
        const save = button({
            variant: "primary",
            onclick: async () => {
                // roles sits behind permlevel 1 (C1) — a non-admin sending it at
                // all throws E_FIELD_FORBIDDEN and takes the WHOLE save down with
                // it, even for an ordinary name/bio/email edit. This route has no
                // roles of its own to check (ctx carries no session), so it asks
                // the one place that already knows: /api/v1/_session. Only an
                // admin's patch ever carries the key.
                const session = await ctx.api.session()
                const isAdmin = session.ok && (session.data.roles || []).includes("admin")
                const patch = { ...values }
                if (isAdmin) patch.roles = JSON.stringify([...held])
                const r = await ctx.api.update("nexus_user", row.id, patch)
                toast(r.ok ? "Saved — live" : r.error.code + ": " + (r.error.message || ""), r.ok ? "ok" : "err")
                ctx.closeDrawer()
                load()
            }
        }, ["Save"])
        actions.append(remove, spread, save)
        wrap.append(rolesWrap, actions)
        ctx.drawer(row.name || row.pub, wrap)
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
    const unsubscribe = subscribe(["nexus_user", "nexus_role"], () => {
        if (!host.isConnected) return unsubscribe() // the router has no unmount hook — stale routes reap themselves
        clearTimeout(reloadTimer)
        reloadTimer = setTimeout(load, 250) // collapse bursts into one reload
    })
    return host
}
