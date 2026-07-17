/** Users module — identities (ZEN pubkey + roles): who's who, add by key or
 *  "add me as admin", edit roles inline, remove. Changes hot-apply: adding the
 *  first identity turns authentication ON immediately (sign in right after). */
import { el, icon } from "../lib.js"

export function render(ctx) {
    const list = el("div", { class: "nx-card" }, [el("p", { class: "nx-muted", text: "…" })])
    const banner = el("div")

    async function load() {
        const r = await ctx.api.studio("users", "GET")
        const ids = r.ok ? r.data.identities : []
        banner.replaceChildren()
        if (r.ok && !r.data.authRequired)
            banner.append(el("div", {
                class: "nx-card", style: "border-left:3px solid var(--accent)",
                html: `<b>DEV mode — no authentication.</b><br>
                <span class="nx-muted">Anyone on this port is the all-powerful DEV admin. Adding the first identity turns
                authentication ON immediately: you sign in with your passphrase, and Permissions start deciding who can do what.</span>`
            }))
        list.replaceChildren()
        if (!ids.length) {
            const empty = el("div", { class: "nx-empty" }, [el("div", { style: "--icon:var(--icon-lg);color:var(--muted);margin-bottom:0.375rem" }, [icon("person")]), el("div", { text: "No identities yet" })])
            empty.append(el("button", { class: "nx-btn primary", style: "margin-top:0.75rem", onclick: addMe }, [icon("plus-lg"), document.createTextNode("Add me as admin")]))
            list.append(empty)
            return
        }
        for (const u of ids) {
            const who = el("div", { class: "nx-who" }, [el("div", { text: u.name || "(unnamed)" }), el("div", { class: "nx-pub", text: u.pub })])
            const roles = el("span", {
                class: "nx-chip accent", style: "cursor:pointer", title: "Edit roles",
                text: (u.roles || []).join(", ") || "no roles",
                onclick: async () => {
                    const next = prompt("Roles for " + (u.name || u.pub.slice(0, 12) + "…") + " (comma-separated):", (u.roles || []).join(", "))
                    if (next === null) return
                    const rr = await ctx.api.studio("users", "POST", { action: "role", pub: u.pub, roles: next.split(",").map((s) => s.trim()).filter(Boolean) })
                    ctx.toast(rr.ok ? "Roles updated & applied" : rr.error.code, rr.ok ? "ok" : "err")
                    load()
                }
            })
            const del = el("button", {
                class: "nx-btn icon", title: "Remove",
                onclick: async () => {
                    if (!confirm("Remove " + (u.name || u.pub.slice(0, 12) + "…") + "?")) return
                    await ctx.api.studio("users", "POST", { action: "remove", pub: u.pub })
                    ctx.toast("Identity removed & applied")
                    load()
                }
            }, [icon("x-lg")])
            list.append(el("div", { class: "nx-row" }, [who, roles, del]))
        }
    }

    async function addMe() {
        const pass = prompt("Choose a passphrase for your admin identity (it derives your key — you will sign in with it):")
        if (!pass) return
        const { pair } = await ctx.deriveKeypair(pass)
        const r = await ctx.api.studio("users", "POST", { action: "add", pub: pair.pub, name: "admin", roles: ["admin"] })
        if (!r.ok) return ctx.toast(r.error.code, "err")
        if (r.data.authRequired) {
            ctx.toast("Admin added — authentication is now ON. Sign in with your passphrase.")
            setTimeout(() => location.reload(), 1200)
        } else {
            ctx.toast("Admin added & applied")
            load()
        }
    }

    const pub = el("input", { class: "nx-input", placeholder: "public key", style: "flex:2;width:auto" })
    const nm = el("input", { class: "nx-input", placeholder: "name", style: "flex:1;width:auto;max-width:160px" })
    const rl = el("input", { class: "nx-input", placeholder: "roles (comma) e.g. admin,editor", style: "flex:1;width:auto;max-width:220px" })
    const add = el("button", {
        class: "nx-btn primary", text: "Add user",
        onclick: async () => {
            const r = await ctx.api.studio("users", "POST", { action: "add", pub: pub.value.trim(), name: nm.value.trim() || undefined, roles: rl.value.split(",").map((s) => s.trim()).filter(Boolean) })
            if (!r.ok) return ctx.toast(r.error.code + ": " + (r.error.message || ""), "err")
            pub.value = nm.value = rl.value = ""
            ctx.toast("User added & applied")
            load()
        }
    })
    load()
    return el("div", {}, [
        el("div", { class: "nx-head" }, [el("h1", { text: ctx.t("users") }), el("span", { class: "nx-spacer" }), el("button", { class: "nx-btn", onclick: addMe }, [icon("plus-lg"), document.createTextNode("Add me as admin")])]),
        banner,
        list,
        el("div", { class: "nx-card" }, [el("p", { class: "nx-muted", text: "Add an identity by public key — the person signs in with the passphrase that derives it. Roles connect identities to Permissions policies." }), el("div", { class: "nx-toolbar" }, [pub, nm, rl, add])])
    ])
}
