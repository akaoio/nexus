/** Users module — identities (ZEN pubkey + roles): who's who, add by key or
 *  "add me as admin", remove. */
import { el } from "../lib.js"

export function render(ctx) {
    const list = el("div", { class: "nx-card" }, [el("p", { class: "nx-muted", text: "…" })])

    async function load() {
        const r = await ctx.api.studio("users", "GET")
        const ids = r.ok ? r.data.identities : []
        list.replaceChildren()
        if (!ids.length) {
            const empty = el("div", { class: "nx-empty" }, [el("div", { class: "big", text: "👤" }), el("div", { text: "No users yet — the site runs in open DEV mode" })])
            empty.append(el("button", { class: "nx-btn primary", style: "margin-top:12px", text: "＋ Add me as admin", onclick: addMe }))
            list.append(empty); return
        }
        for (const u of ids) {
            const who = el("div", { class: "nx-who" }, [el("div", { text: u.name || "(unnamed)" }), el("div", { class: "nx-pub", text: u.pub })])
            const del = el("button", { class: "nx-btn icon", text: "✕", title: "Remove", onclick: async () => { if (confirm("Remove " + (u.name || u.pub.slice(0, 12) + "…") + "?")) { await ctx.api.studio("users", "POST", { action: "remove", pub: u.pub }); load() } } })
            list.append(el("div", { class: "nx-row" }, [who, el("span", { class: "nx-chip", text: (u.roles || []).join(", ") || "no roles" }), del]))
        }
    }
    async function addMe() {
        const pass = prompt("Choose a passphrase for your admin identity (it derives your key):")
        if (!pass) return
        const { pair } = await ctx.deriveKeypair(pass)
        const r = await ctx.api.studio("users", "POST", { action: "add", pub: pair.pub, name: "admin", roles: ["admin"] })
        ctx.toast(r.ok ? "Added as admin — restart nexus dev, then sign in with this passphrase" : r.error.code, r.ok ? "ok" : "err")
        load()
    }
    const pub = el("input", { class: "nx-input", placeholder: "public key" })
    const nm = el("input", { class: "nx-input", placeholder: "name", style: "max-width:160px" })
    const rl = el("input", { class: "nx-input", placeholder: "roles (comma) e.g. admin,editor", style: "max-width:220px" })
    const add = el("button", {
        class: "nx-btn primary", text: "Add user",
        onclick: async () => {
            const r = await ctx.api.studio("users", "POST", { action: "add", pub: pub.value.trim(), name: nm.value.trim() || undefined, roles: rl.value.split(",").map((s) => s.trim()).filter(Boolean) })
            if (!r.ok) return ctx.toast(r.error.code + ": " + (r.error.message || ""), "err")
            pub.value = nm.value = rl.value = ""; ctx.toast("User added — restart nexus dev to apply"); load()
        }
    })
    load()
    return el("div", {}, [
        el("div", { class: "nx-head" }, [el("h1", { text: ctx.t("users") }), el("span", { class: "nx-spacer" }), el("button", { class: "nx-btn", text: "＋ Add me as admin", onclick: addMe })]),
        list,
        el("div", { class: "nx-card" }, [el("p", { class: "nx-muted", text: "Add an identity by public key:" }), el("div", { class: "nx-toolbar" }, [pub, nm, rl, add])])
    ])
}
