/**
 * Studio shell — the composition root: reads boot data, wires state, auth,
 * i18n and theme, and mounts routes into the layout. Structure lives in
 * templates; text in the dictionary (<nx-t>); icons in <nx-icon>; heavy work
 * in worker threads; the URL in the kernel Router. This file only composes.
 */

import { icon, t, button, toast, createApi, createI18n, createTheme } from "./lib.js"
import { buildLayout, buildLogin } from "../layouts/studio/index.js"
// routes — one FOLDER per route, nested like the URL (the akao routes shape)
import * as content from "./routes/entity/[entity]/index.js"
import * as entity from "./routes/model/index.js"
import * as permissions from "./routes/permissions/index.js"
import * as users from "./routes/users/index.js"
import * as ai from "./routes/ai/index.js"
import * as settings from "./routes/settings/index.js"
import * as search from "./routes/search/index.js"
// widgets the routes compose (register the custom elements) — via their
// STABLE paths (the shims), which is the public component surface
import "/_nexus/src/studio/query-builder.js"
import "/_nexus/src/studio/form-builder.js"
import "/_nexus/src/studio/schema-designer.js"
import "/_nexus/src/studio/permission-manager.js"
import "/_nexus/src/studio/list-view.js"
import "/_nexus/src/studio/search.js"
import { NxA } from "/_nexus/src/studio/components/a/index.js"

const boot = JSON.parse(document.getElementById("nx-boot").textContent)
const schemas = boot.schemas
const i18n = createI18n(boot.i18n)
const theme = createTheme()
const state = { view: schemas[0] ? "content" : "entity", entity: schemas[0] ? schemas[0].name : null }
const api = createApi({ onUnauthorized: () => showLogin() })

// the akao `a` primitive pre-caches what it points to — wire its fetcher
NxA.fetchRows = async (name) => {
    const r = await api.list(name, null)
    return r.ok ? r.data : null
}

// ── threads (the akao Launcher discipline) ─────────────────────────────────────
// This module IS the main thread; heavy work registers as workers so the UI
// never freezes. Keypair derivation (KDF) is the first real occupant.
import { Threads } from "/_nexus/src/kernel/Threads.js"
import { Router } from "/_nexus/src/kernel/Router.js"
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

// the route registry (order = sidebar "Build" order)
const MODULES = {
    content: { render: content.render },
    entity: { icon: "plus-lg", key: "dataModel", render: entity.render },
    permissions: { icon: "shield-lock", key: "permissions", render: permissions.render },
    users: { icon: "person", key: "users", render: users.render },
    ai: { icon: "stars", key: "ai", render: ai.render },
    settings: { icon: "gear", key: "settings", render: settings.render },
    search: { icon: "search", key: "search", render: search.render }
}
const BUILD = ["entity", "permissions", "users", "ai", "settings", "search"]

// ── topbar widgets (native primitives + components — no ad-hoc helpers) ────────
const localeSel = document.createElement("select")
localeSel.className = "nx-btn"
for (const code of i18n.locales) {
    const option = document.createElement("option")
    option.value = code
    option.textContent = i18n.names[code] || code
    option.selected = code === i18n.locale
    localeSel.append(option)
}
localeSel.addEventListener("change", () => {
    i18n.set(localeSel.value)
    render()
})

const themeBtn = button({ variant: "icon", iconName: theme.icon(), title: "Theme", onclick: () => { theme.cycle(); themeBtn.dataset.icon = theme.icon() } })

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
const embadge = document.createElement("span")
embadge.className = "nx-chip" + (boot.embedder.mode === "semantic" ? " on" : "")
embadge.textContent = embLabel(boot.embedder)
embadge.title = embTitle(boot.embedder)

// ── layout ─────────────────────────────────────────────────────────────────────
const layout = buildLayout({ site: boot.site, badge: embadge, localeSel, themeBtn })
const { app, main, nav, entNav, drawer, openDrawer, closeDrawer } = layout

const login = buildLogin({ site: boot.site, onSubmit: doLogin })

// the shell's footer is already in the body — the app mounts above it, overlays after
const foot = document.querySelector("footer.nx-foot")
if (foot) foot.before(app); else document.body.append(app)
document.body.append(drawer, login)

const ctx = {
    api, i18n, schemas, state, appName: boot.appName, embedder: boot.embedder, toast,
    drawer: openDrawer, closeDrawer, navigate, deriveKeypair
}

// ── navigation + render ────────────────────────────────────────────────────────
/** A sidebar link: <a is="nx-a"> — the primitive PRE-CACHES its target. */
function navLink({ href, active, iconName, label }) {
    const a = document.createElement("a", { is: "nx-a" })
    a.setAttribute("is", "nx-a") // serialize for clarity; define() already upgraded it
    a.href = href
    a.className = active ? "active" : ""
    const ico = document.createElement("span")
    ico.className = "ico"
    ico.append(icon(iconName))
    a.append(ico, label)
    return a
}

function renderNav() {
    entNav.replaceChildren(...schemas.map((s) =>
        navLink({
            href: "#/entity/" + s.name,
            active: state.view === "content" && state.entity === s.name,
            iconName: "database",
            label: document.createTextNode(s.name)
        })
    ))
    nav.replaceChildren(...BUILD.map((name) =>
        navLink({
            href: "#/" + name,
            active: state.view === name,
            iconName: MODULES[name].icon,
            label: t(MODULES[name].key)
        })
    ))
}

function render() {
    document.documentElement.lang = i18n.locale
    localeSel.value = i18n.locale
    renderNav()
    main.replaceChildren(MODULES[state.view].render(ctx))
}

// ── routing (kernel Router, akao pattern syntax) — the URL is the state ───────
const ROUTES = ["/entity/[entity]", "/[view]"]
function applyHash() {
    const { route, params } = Router.process({ path: location.hash.slice(1) || "/", routes: ROUTES, locales: [] })
    if (route === "/entity/[entity]" && schemas.some((s) => s.name === params.entity)) {
        state.view = "content"
        state.entity = params.entity
    } else if (route === "/[view]" && MODULES[params.view] && params.view !== "content") {
        state.view = params.view
    }
    app.classList.remove("open")
    render()
}
window.addEventListener("hashchange", applyHash)
function navigate(view, entity) {
    const next = view === "content" ? "#/entity/" + (entity ?? state.entity) : "#/" + view
    if (location.hash === next) return applyHash() // same route → just re-render
    location.hash = next // hashchange → applyHash → render
}

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

applyHash() // route from the URL (deep links work); falls back to the default state
checkSession()
