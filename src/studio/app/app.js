/**
 * Studio shell — composes the modules into a themed, localized, mobile-first
 * admin. Reads boot data, builds the header + sidebar + router, and mounts a
 * module into <main> on navigation. All chrome text goes through i18n; the API
 * carries the session token; login gates when auth is required.
 */

import { el, toast, createApi, createI18n, createTheme } from "./lib.js"
import * as content from "./modules/content.js"
import * as entity from "./modules/entity.js"
import * as permissions from "./modules/permissions.js"
import * as users from "./modules/users.js"
import * as ai from "./modules/ai.js"
import * as settings from "./modules/settings.js"
import * as search from "./modules/search.js"
// widgets the modules compose (register the custom elements)
import "/_nexus/src/studio/query-builder.js"
import "/_nexus/src/studio/form-builder.js"
import "/_nexus/src/studio/schema-designer.js"
import "/_nexus/src/studio/permission-manager.js"
import "/_nexus/src/studio/list-view.js"
import "/_nexus/src/studio/search.js"

const boot = JSON.parse(document.getElementById("nx-boot").textContent)
const schemas = boot.schemas
const i18n = createI18n(boot.i18n)
const theme = createTheme()
const state = { view: schemas[0] ? "content" : "entity", entity: schemas[0] ? schemas[0].name : null }
const api = createApi({ onUnauthorized: () => showLogin() })

const deriveKeypair = async (passphrase) => { const ZEN = (await import("/_nexus/vendor/zen/zen.js")).default; return { ZEN, pair: await ZEN.pair(null, { seed: passphrase }) } }

// the module registry (order = sidebar "Build" order)
const MODULES = {
    content: { render: content.render },
    entity: { icon: "＋", key: "dataModel", render: entity.render },
    permissions: { icon: "⚿", key: "permissions", render: permissions.render },
    users: { icon: "👤", key: "users", render: users.render },
    ai: { icon: "✦", key: "ai", label: "AI models", render: ai.render },
    settings: { icon: "⚙", key: "settings", render: settings.render },
    search: { icon: "⌕", key: "search", render: search.render }
}
const BUILD = ["entity", "permissions", "users", "ai", "settings", "search"]

const ctx = {
    api, i18n, t: i18n.t, schemas, state, appName: boot.appName, embedder: boot.embedder, toast,
    drawer: openDrawer, closeDrawer, navigate, deriveKeypair
}

// ── layout ─────────────────────────────────────────────────────────────────────
const main = el("main", { class: "nx-main", id: "nx-main" })
const nav = el("nav", { class: "nx-nav", id: "nx-nav" })
const localeSel = el("select", { class: "nx-btn", style: "padding:7px 8px", onchange: (e) => { i18n.set(e.target.value); render() } },
    i18n.locales.map((c) => el("option", { value: c, text: i18n.names[c] || c, selected: c === i18n.locale })))
const themeBtn = el("button", { class: "nx-btn icon", text: theme.icon(), title: "Theme", onclick: () => { theme.cycle(); themeBtn.textContent = theme.icon() } })
const shortModel = (id) => (id ? id.split("/").pop().replace(/-ONNX$/i, "") : "model")
function embLabel(e) {
    if (e.mode === "semantic") return "semantic · " + shortModel(e.name)
    if (e.mode === "lexical") return e.wanted ? "model not installed" : "lexical"
    return "no embedder"
}
function embTitle(e) {
    if (e.mode === "semantic") return "Semantic search via " + e.name + (e.indexed === false ? " — but no Entity declares a semantic: block yet" : "")
    if (e.mode === "lexical" && e.wanted) return e.wanted + " is set but @huggingface/transformers is not installed — run: nexus model pull"
    if (e.mode === "lexical") return "Keyword search. Set a model in AI models for semantic ranking."
    return "No model configured and no Entity is indexed for search."
}
const embadge = el("span", { class: "nx-chip" + (boot.embedder.mode === "semantic" ? " on" : ""), text: embLabel(boot.embedder), title: embTitle(boot.embedder) })
const app = el("div", { class: "nx-app", id: "nx-app" }, [
    el("header", { class: "nx-top" }, [
        el("button", { class: "nx-btn icon nx-hamb", text: "☰", onclick: () => app.classList.toggle("open") }),
        el("span", { class: "nx-brand", html: "⬡ " + boot.site + " <small>Studio</small>" }),
        el("span", { class: "nx-spacer" }), embadge, localeSel, themeBtn
    ]),
    el("div", { class: "nx-scrim", onclick: () => app.classList.remove("open") }),
    el("aside", { class: "nx-side" }, [el("div", { class: "nx-grouplabel", text: i18n.t("collections") }), el("nav", { class: "nx-nav", id: "nx-nav-ent" }), el("div", { class: "nx-grouplabel", text: i18n.t("build") }), nav]),
    main
])
const drawer = el("div", { class: "nx-drawer", id: "nx-drawer" }, [
    el("div", { class: "nx-drawer-back", onclick: closeDrawer }),
    el("div", { class: "nx-drawer-panel" }, [el("h2", { id: "nx-drawer-title" }), el("div", { id: "nx-drawer-slot" })])
])
const login = el("div", { class: "nx-login", id: "nx-login", hidden: true }, [
    el("div", { class: "nx-card", style: "width:min(94vw,380px)" }, [
        el("h2", { html: "⬡ " + boot.site, style: "margin:0 0 4px" }),
        el("p", { class: "nx-muted", text: "Sign in" }),
        el("div", { class: "nx-field" }, [el("label", { class: "nx-label", text: "Passphrase" }), el("input", { id: "nx-pass", class: "nx-input", type: "password", placeholder: "your secret passphrase", onkeydown: (e) => { if (e.key === "Enter") doLogin() } })]),
        el("div", { class: "nx-actions" }, [el("button", { class: "nx-btn primary", style: "flex:1", text: "Sign in", onclick: doLogin })]),
        el("div", { class: "nx-err", id: "nx-login-err" }),
        el("p", { class: "nx-muted", style: "font-size:12px", text: "Your passphrase derives a ZEN keypair in this browser — no password is sent. An admin must add your public key first." })
    ])
])
document.body.append(app, drawer, login)

// ── navigation + render ─────────────────────────────────────────────────────────
function renderNav() {
    const entNav = document.getElementById("nx-nav-ent"); entNav.replaceChildren()
    for (const s of schemas) {
        const a = el("a", { class: state.view === "content" && state.entity === s.name ? "active" : "", onclick: () => navigate("content", s.name) }, [el("span", { class: "ico", text: "▤" }), document.createTextNode(s.name)])
        entNav.append(a)
    }
    nav.replaceChildren()
    for (const name of BUILD) {
        const m = MODULES[name]
        const a = el("a", { class: state.view === name ? "active" : "", onclick: () => navigate(name) }, [el("span", { class: "ico", text: m.icon }), document.createTextNode(i18n.t(m.key, m.label))])
        nav.append(a)
    }
}
function render() {
    document.documentElement.lang = i18n.locale
    localeSel.value = i18n.locale
    renderNav()
    main.replaceChildren(MODULES[state.view].render(ctx))
}
function navigate(view, entity) { state.view = view; if (entity) state.entity = entity; app.classList.remove("open"); render() }

// ── drawer ───────────────────────────────────────────────────────────────────
function openDrawer(title, node) { document.getElementById("nx-drawer-title").textContent = title; const slot = document.getElementById("nx-drawer-slot"); slot.replaceChildren(node); drawer.classList.add("show") }
function closeDrawer() { drawer.classList.remove("show") }
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeDrawer() })

// ── auth ─────────────────────────────────────────────────────────────────────
function showLogin(msg) { login.hidden = false; if (msg) document.getElementById("nx-login-err").textContent = msg }
async function checkSession() { const s = await api.session(); const d = s.ok ? s.data : { authRequired: false }; if (d.authRequired && !d.user) showLogin(); else login.hidden = true }
async function doLogin() {
    const err = document.getElementById("nx-login-err"); err.textContent = ""
    const pass = document.getElementById("nx-pass").value
    if (!pass) return (err.textContent = "Enter a passphrase")
    try {
        const { ZEN, pair } = await deriveKeypair(pass)
        const ch = await (await fetch("/api/v1/_auth/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json()
        if (!ch.ok) return (err.textContent = "Challenge failed")
        const signature = await ZEN.sign(ch.data.nonce, pair)
        const v = await (await fetch("/api/v1/_auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pub: pair.pub, nonce: ch.data.nonce, signature }) })).json()
        if (!v.ok) return (err.textContent = v.error.code + ": " + (v.error.message || ""))
        if (!v.data.roles.length) return (err.textContent = "This key is not registered. Ask an admin to add: " + pair.pub)
        api.setToken(v.data.token); location.reload()
    } catch (e) { err.textContent = "Login error: " + e.message }
}

render()
checkSession()
