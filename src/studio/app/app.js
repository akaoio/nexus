/**
 * Studio shell — the composition root: reads boot data, wires state, auth,
 * i18n and theme, and mounts modules into the layout. The chrome itself
 * (structure + styles) lives in layouts/studio (akao pattern); the widgets
 * live in components/ as triads; this file only composes.
 */

import { el, toast, createApi, createI18n, createTheme } from "./lib.js"
import { buildLayout, buildLogin } from "../layouts/studio/index.js"
import * as content from "./modules/content.js"
import * as entity from "./modules/entity.js"
import * as permissions from "./modules/permissions.js"
import * as users from "./modules/users.js"
import * as ai from "./modules/ai.js"
import * as settings from "./modules/settings.js"
import * as search from "./modules/search.js"
// widgets the modules compose (register the custom elements) — imported via
// their STABLE paths (the shims), which is the public component surface
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

// ── threads (the akao Launcher discipline) ─────────────────────────────────────
// This module IS the main thread; heavy work registers as workers so the UI
// never freezes. Keypair derivation (KDF) is the first real occupant.
import { Threads } from "/_nexus/src/kernel/Threads.js"
const threads = new Threads()
threads.register("crypto", { worker: true, type: "module", url: new URL("./threads/crypto.js", import.meta.url) })

const deriveKeypair = async (passphrase) => {
    const ZEN = (await import("/_nexus/vendor/zen/zen.js")).default // sign() stays cheap, on main
    try {
        const pair = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("crypto thread timeout")), 15000)
            threads.queue({
                thread: "crypto", method: "derive", params: { seed: passphrase },
                callback: (result) => { clearTimeout(timer); result?.message ? reject(new Error(result.message)) : resolve(result) }
            })
        })
        return { ZEN, pair }
    } catch {
        // resilience: a worker failure falls back to deriving on main
        return { ZEN, pair: await ZEN.pair(null, { seed: passphrase }) }
    }
}

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

// ── topbar widgets ─────────────────────────────────────────────────────────────
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

// ── layout ─────────────────────────────────────────────────────────────────────
const layout = buildLayout({
    site: boot.site,
    badge: embadge,
    localeSel,
    themeBtn,
    labels: { collections: i18n.t("collections"), build: i18n.t("build") }
})
const { app, main, nav, entNav, drawer, openDrawer, closeDrawer } = layout

const login = buildLogin({ site: boot.site, onSubmit: doLogin })

// the shell's footer is already in the body — the app mounts above it, overlays after
const foot = document.querySelector("footer.nx-foot")
if (foot) foot.before(app); else document.body.append(app)
document.body.append(drawer, login)

const ctx = {
    api, i18n, t: i18n.t, schemas, state, appName: boot.appName, embedder: boot.embedder, toast,
    drawer: openDrawer, closeDrawer, navigate, deriveKeypair
}

// ── navigation + render ────────────────────────────────────────────────────────
function renderNav() {
    entNav.replaceChildren()
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

// ── keyboard ───────────────────────────────────────────────────────────────────
document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeDrawer()
    // "/" focuses the page's primary query box (Frappe's awesomebar habit)
    if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName ?? "")) {
        const box = main.querySelector("input")
        if (box) { e.preventDefault(); box.focus() }
    }
})

// ── auth ───────────────────────────────────────────────────────────────────────
function showLogin(msg) { login.hidden = false; if (msg) login.querySelector("#nx-login-err").textContent = msg }
async function checkSession() { const s = await api.session(); const d = s.ok ? s.data : { authRequired: false }; if (d.authRequired && !d.user) showLogin(); else login.hidden = true }
async function doLogin(pass, err) {
    err.textContent = ""
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
