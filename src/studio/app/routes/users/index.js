/** /users route — logic: identities (ZEN pubkey + roles), hot-applied.
 *  Adding the first identity turns authentication ON immediately. */

import { mountTemplate, button, icon, toast, confirmDialog } from "../../lib.js"
import { usersTemplate } from "./template.js"

export function render(ctx) {
    const c = {}
    const host = mountTemplate(usersTemplate(c, {
        onAddMe: addMe,
        onAdd: async () => {
            const r = await ctx.api.studio("users", "POST", {
                action: "add", pub: c.$pub.value.trim(), name: c.$name.value.trim() || undefined,
                roles: c.$roles.value.split(",").map((s) => s.trim()).filter(Boolean)
            })
            if (!r.ok) return toast(r.error.code + ": " + (r.error.message || ""), "err")
            c.$pub.value = c.$name.value = c.$roles.value = ""
            toast("User added & applied")
            load()
        }
    }))

    async function addMe() {
        const pass = prompt("Choose a passphrase for your admin identity (it derives your key — you will sign in with it):")
        if (!pass) return
        const { pair } = await ctx.deriveKeypair(pass)
        const r = await ctx.api.studio("users", "POST", { action: "add", pub: pair.pub, name: "admin", roles: ["admin"] })
        if (!r.ok) return toast(r.error.code, "err")
        if (r.data.authRequired) {
            toast("Admin added — authentication is now ON. Sign in with your passphrase.")
            setTimeout(() => location.reload(), 1200)
        } else {
            toast("Admin added & applied")
            load()
        }
    }

    async function load() {
        const r = await ctx.api.studio("users", "GET")
        const ids = r.ok ? r.data.identities : []
        c.$banner.replaceChildren()
        if (r.ok && !r.data.authRequired) {
            const card = document.createElement("div")
            card.className = "nx-card"
            card.style.borderLeft = "0.1875rem solid var(--accent)"
            const b = document.createElement("b")
            b.textContent = "DEV mode — no authentication."
            const span = document.createElement("span")
            span.className = "nx-muted"
            span.textContent = " Anyone on this port is the all-powerful DEV admin. Adding the first identity turns authentication ON immediately: you sign in with your passphrase, and Permissions start deciding who can do what."
            card.append(b, document.createElement("br"), span)
            c.$banner.append(card)
        }
        c.$list.replaceChildren()
        if (!ids.length) {
            const empty = document.createElement("div")
            empty.className = "nx-empty"
            const mark = document.createElement("div")
            mark.setAttribute("style", "--icon:var(--icon-lg);color:var(--muted);margin-bottom:0.375rem")
            mark.append(icon("person"))
            const line = document.createElement("div")
            line.textContent = "No identities yet"
            const cta = button({ variant: "primary", iconName: "plus-lg", onclick: addMe }, ["Add me as admin"])
            cta.style.marginTop = "0.75rem"
            empty.append(mark, line, cta)
            c.$list.append(empty)
            return
        }
        for (const u of ids) {
            const row = document.createElement("div")
            row.className = "nx-row"
            const who = document.createElement("div")
            who.className = "nx-who"
            const name = document.createElement("div")
            name.textContent = u.name || "(unnamed)"
            const pub = document.createElement("div")
            pub.className = "nx-pub"
            pub.textContent = u.pub
            who.append(name, pub)
            const roles = document.createElement("span")
            roles.className = "nx-chip accent"
            roles.style.cursor = "pointer"
            roles.title = "Edit roles"
            roles.textContent = (u.roles || []).join(", ") || "no roles"
            roles.addEventListener("click", async () => {
                const next = prompt("Roles for " + (u.name || u.pub.slice(0, 12) + "…") + " (comma-separated):", (u.roles || []).join(", "))
                if (next === null) return
                const rr = await ctx.api.studio("users", "POST", { action: "role", pub: u.pub, roles: next.split(",").map((s) => s.trim()).filter(Boolean) })
                toast(rr.ok ? "Roles updated & applied" : rr.error.code, rr.ok ? "ok" : "err")
                load()
            })
            const del = button({
                variant: "icon", iconName: "x-lg", title: "Remove",
                onclick: async () => {
                    if (!(await confirmDialog("Remove " + (u.name || u.pub.slice(0, 12) + "…") + "?"))) return
                    await ctx.api.studio("users", "POST", { action: "remove", pub: u.pub })
                    toast("Identity removed & applied")
                    load()
                }
            })
            row.append(who, roles, del)
            c.$list.append(row)
        }
    }
    load()
    return host
}
