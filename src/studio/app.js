/**
 * Studio shell — the composition root: reads boot data, wires state, auth,
 * i18n and theme, and mounts routes into the layout. Structure lives in
 * templates; text in the dictionary (<nx-context>); icons in <nx-icon>; heavy work
 * in worker threads; the URL in the kernel Router. This file only composes.
 */

import { icon, text, toast, createApi, createI18n, createTheme } from "./kit.js"
import { buildLayout, buildLogin } from "./layouts/studio/index.js"
// routes — one FOLDER per route, nested like the URL (the akao routes shape)
import * as content from "./routes/entity/[entity]/index.js"
import * as entity from "./routes/model/index.js"
import * as permissions from "./routes/permissions/index.js"
import * as users from "./routes/users/index.js"
import * as ai from "./routes/ai/index.js"
import * as settings from "./routes/settings/index.js"
import * as search from "./routes/search/index.js"
// widgets the routes compose (register the custom elements) — each component's
// index.js is its public surface (the akao way)
import "/_nexus/src/studio/components/query-builder/index.js"
import "/_nexus/src/studio/components/form-builder/index.js"
import "/_nexus/src/studio/components/schema-designer/index.js"
import "/_nexus/src/studio/components/permission-manager/index.js"
import "/_nexus/src/studio/components/list-view/index.js"
import "/_nexus/src/studio/components/search/index.js"
import { NxA } from "/_nexus/src/studio/components/a/index.js"
import { NxUser } from "/_nexus/src/studio/components/user/index.js"
import { passkeySupported, enroll, enrolled, unlock } from "./webauthn.js"

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
import { Threads } from "/_nexus/src/core/Threads.js"
import { Router } from "/_nexus/src/core/Router.js"
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

import { mountLocales, mountThemes } from "./navigators.js"

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
const layout = buildLayout({ site: boot.site, badge: embadge })
const { app, main, nav, entNav, drawer, openDrawer, closeDrawer } = layout

const { login, passkeyRow } = buildLogin({ site: boot.site, onSubmit: doLogin, onPasskey: passkeyLogin })
NxUser.onSignout = () => {
    api.setToken(null)
    location.reload()
}

// the shell's footer is already in the body — the app mounts above it, overlays after
const foot = document.querySelector("footer.nx-foot")
if (foot) foot.before(app); else document.body.append(app)
document.body.append(drawer, login)

const ctx = {
    api, i18n, schemas, state, appName: boot.appName, embedder: boot.embedder, toast,
    drawer: openDrawer, closeDrawer, navigate, deriveKeypair
}

// ── navigation + render ────────────────────────────────────────────────────────
/** A sidebar link: <a is="nx-a"> — localized href, pushState, pre-cache. */
function navLink({ to, active, iconName, label }) {
    const a = document.createElement("a", { is: "nx-a" })
    a.setAttribute("is", "nx-a") // serialize for clarity; define() already upgraded it
    a.dataset.to = to
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
            to: "/entity/" + s.name,
            active: state.view === "content" && state.entity === s.name,
            iconName: "database",
            label: document.createTextNode(s.name)
        })
    ))
    nav.replaceChildren(...BUILD.map((name) =>
        navLink({
            to: "/" + name,
            active: state.view === name,
            iconName: MODULES[name].icon,
            label: text(MODULES[name].key)
        })
    ))
}

function render() {
    document.documentElement.lang = i18n.locale
    renderNav()
    main.replaceChildren(MODULES[state.view].render(ctx))
}

// ── routing — REAL paths, locale-prefixed: /vi/entity/task (the akao shape) ───
const ROUTES = ["/entity/[entity]", "/[view]"]
const LOCALES = i18n.locales.map((code) => ({ code }))
const hrefFor = (to) => Router.process({ path: to, routes: ROUTES, locales: LOCALES, locale: i18n.locale }).path

function applyRoute() {
    const r = Router.process({ path: location.pathname, routes: ROUTES, locales: LOCALES })
    // the URL's locale prefix IS the locale
    if (r.locale && r.locale.code !== i18n.locale) i18n.set(r.locale.code)
    if (r.route === "/entity/[entity]" && schemas.some((s) => s.name === r.params.entity)) {
        state.view = "content"
        state.entity = r.params.entity
    } else if (r.route === "/[view]" && MODULES[r.params.view] && r.params.view !== "content") {
        state.view = r.params.view
    }
    // canonicalize (adds the locale prefix and the trailing slash)
    if (location.pathname !== r.path) history.replaceState({}, "", r.path + location.search)
    app.classList.remove("open")
    render()
}
window.addEventListener("popstate", applyRoute)
function navigate(view, entity) {
    const to = view === "content" ? "/entity/" + (entity ?? state.entity) : "/" + view
    const path = hrefFor(to)
    if (location.pathname !== path) history.pushState({}, "", path)
    applyRoute()
}
// the nx-a primitive drives the same machinery
NxA.hrefFor = hrefFor
NxA.go = (to) => {
    const path = hrefFor(to)
    if (location.pathname !== path) history.pushState({}, "", path)
    applyRoute()
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
async function checkSession() {
    const s = await api.session()
    const d = s.ok ? s.data : { authRequired: false }
    if (d.authRequired && !d.user) {
        showLogin()
        // a device-locked key offers one-touch unlock (akao WebAuthn PRF)
        if (passkeySupported() && (await enrolled())) passkeyRow.hidden = false
    } else {
        login.hidden = true
        if (d.user) layout.user.dataset.pub = d.user
    }
}
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
        api.setToken(v.data.token)
        // offer to LOCK the key to this device: passkey + PRF → AES — the
        // pair is stored only encrypted; unlocking is one biometric touch
        if (passkeySupported() && !(await enrolled())) {
            try {
                const { confirmDialog } = await import("./kit.js")
                if (await confirmDialog("Lock your key to this device with a passkey? Next time you sign in with one touch — the key is stored encrypted only.")) await enroll(pair)
            } catch {}
        }
        location.reload()
    } catch (e) { err.textContent = "Login error: " + e.message }
}

/** Sign in via the device passkey: assert → decrypt pair → ZEN handshake. */
async function passkeyLogin(err) {
    err.textContent = ""
    try {
        const pair = await unlock()
        if (!pair) return (err.textContent = "Passkey unlock failed")
        const ZEN = (await import("/_nexus/vendor/zen/zen.js")).default
        const ch = await (await fetch("/api/v1/_auth/challenge", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).json()
        if (!ch.ok) return (err.textContent = "Challenge failed")
        const signature = await ZEN.sign(ch.data.nonce, pair)
        const v = await (await fetch("/api/v1/_auth/verify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pub: pair.pub, nonce: ch.data.nonce, signature }) })).json()
        if (!v.ok) return (err.textContent = v.error.code + ": " + (v.error.message || ""))
        api.setToken(v.data.token)
        location.reload()
    } catch (e) { err.textContent = "Passkey error: " + e.message }
}

if (location.hash.startsWith("#/")) history.replaceState({}, "", location.hash.slice(1)) // legacy hash links
applyRoute() // route from the URL (deep links work); falls back to the default state
// populate the orbit AFTER routing so the active locale/theme marker is
// correct on load (the URL's locale prefix may differ from the stored one)
mountLocales(layout.localesNav, { current: i18n.locale, onSelect: (code) => { i18n.set(code); navigate(state.view, state.entity) } })
mountThemes(layout.themesNav, { current: theme.value, onSelect: (mode) => theme.set(mode) })
checkSession()
