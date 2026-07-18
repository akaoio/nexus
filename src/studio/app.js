/**
 * Studio shell — the composition root: reads boot data, wires state, auth,
 * i18n and theme, and mounts routes into the layout. Structure lives in
 * templates; text in the dictionary (<nx-context>); icons in <nx-icon>; heavy work
 * in worker threads; the URL in the kernel Router. This file only composes.
 */

import { icon, text, toast, createApi, createI18n, createTheme } from "./kit/index.js"
import { buildLayout, buildLogin } from "./layouts/studio/index.js"
// routes — one FOLDER per route, nested like the URL (the akao routes shape)
import * as content from "./routes/entity/[entity]/index.js"
import * as entities from "./routes/entities/index.js"
import * as permissions from "./routes/permissions/index.js"
import * as roles from "./routes/roles/index.js"
import * as users from "./routes/users/index.js"
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
import { passkeySupported, enroll, enrolled, unlock } from "./kit/webauthn.js"

const boot = JSON.parse(document.getElementById("nx-boot").textContent)
const schemas = boot.schemas
const i18n = createI18n(boot.i18n)
const theme = createTheme()
const state = { view: schemas[0] ? "content" : "entities", entity: schemas[0] ? schemas[0].name : null, feature: null }
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

// the route registry (order = sidebar "Build" order); settings carries its
// feature children (/settings/<feature>) — the hub delegates by state.feature
const MODULES = {
    content: { render: content.render },
    entities: { icon: "plus-lg", key: "entities", render: entities.render },
    permissions: { icon: "shield-lock", key: "permissions", render: permissions.render },
    roles: { icon: "sliders", key: "roles", render: roles.render },
    users: { icon: "person", key: "users", render: users.render },
    search: { icon: "search", key: "search", render: search.render },
    settings: { icon: "gear", key: "settings", render: settings.render }
}
const BUILD = ["entities", "permissions", "roles", "users", "search", "settings"]

// ── layout ─────────────────────────────────────────────────────────────────────
const layout = buildLayout({ site: boot.site })
const { app, main, nav, entNav, drawer, openDrawer, closeDrawer } = layout

const { login, passkeyRow } = buildLogin({ site: boot.site, onSubmit: doLogin, onPasskey: passkeyLogin })
NxUser.onSignout = () => {
    api.setToken(null)
    location.reload()
}
NxUser.onProfile = () => navigate("users")

// ── the two-level sidebar: full ↔ icons, one attribute, remembered ─────────────
const NAV_MODES = ["full", "icons"]
let navMode = localStorage.getItem("nexus-nav") || "full"
const applyNav = () => {
    app.dataset.nav = navMode
    layout.navToggle.title = navMode === "full" ? "Collapse to icons" : "Expand the sidebar"
}
applyNav()
layout.navToggle.addEventListener("click", () => {
    navMode = NAV_MODES[(NAV_MODES.indexOf(navMode) + 1) % NAV_MODES.length]
    localStorage.setItem("nexus-nav", navMode)
    applyNav()
})

// ── search lives in the HEADER: an overlay panel, "/" opens it ─────────────────
const headerSearch = document.createElement("nx-search")
headerSearch.schemas = schemas
headerSearch.searcher = async ({ entity, query }) => {
    const r = await api.search(entity, query)
    return r.ok ? r.data : []
}
layout.searchbar.append(headerSearch)
const toggleSearch = (open) => {
    layout.searchbar.hidden = open === undefined ? !layout.searchbar.hidden : !open
    if (!layout.searchbar.hidden) headerSearch.shadowRoot?.querySelector("input")?.focus()
}
layout.searchToggle.addEventListener("click", () => toggleSearch())

// the shell's footer is already in the body — the app mounts above it, overlays after
const foot = document.querySelector("footer.nx-foot")
if (foot) foot.before(app); else document.body.append(app)
document.body.append(drawer, login)

const ctx = {
    api, i18n, theme, schemas, state, appName: boot.appName, embedder: boot.embedder, toast,
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
    const lbl = document.createElement("span")
    lbl.className = "lbl"
    lbl.append(label)
    a.append(ico, lbl)
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
    nav.replaceChildren(...BUILD.flatMap((name) => {
        const links = [navLink({
            to: "/" + name,
            active: state.view === name && (name !== "settings" || !state.feature),
            iconName: MODULES[name].icon,
            label: text(MODULES[name].key)
        })]
        // settings children ride indented under their parent — the URL shape
        // /settings/<feature> IS the sidebar shape (no orbit, no second nav)
        if (name === "settings")
            for (const [id, feature] of Object.entries(settings.FEATURES)) {
                const link = navLink({
                    to: "/settings/" + id,
                    active: state.view === "settings" && state.feature === id,
                    iconName: feature.icon,
                    label: text(feature.key, id)
                })
                link.classList.add("sub")
                links.push(link)
            }
        return links
    }))
}

function render() {
    document.documentElement.lang = i18n.locale
    renderNav()
    main.replaceChildren(MODULES[state.view].render(ctx))
}

// ── routing — REAL paths, locale-prefixed: /vi/entity/task (the akao shape) ───
const ROUTES = ["/entity/[entity]", "/settings/[feature]", "/[view]"]
const LOCALES = i18n.locales.map((code) => ({ code }))
const hrefFor = (to) => Router.process({ path: to, routes: ROUTES, locales: LOCALES, locale: i18n.locale }).path

function applyRoute() {
    const r = Router.process({ path: location.pathname, routes: ROUTES, locales: LOCALES })
    // the URL's locale prefix IS the locale
    if (r.locale && r.locale.code !== i18n.locale) i18n.set(r.locale.code)
    if (r.route === "/entity/[entity]" && schemas.some((s) => s.name === r.params.entity)) {
        state.view = "content"
        state.entity = r.params.entity
    } else if (r.route === "/settings/[feature]" && settings.FEATURES[r.params.feature]) {
        state.view = "settings"
        state.feature = r.params.feature
    } else if (r.route === "/[view]" && r.params.view === "entity") {
        state.view = "entities" // legacy singular URL
        state.feature = null
    } else if (r.route === "/[view]" && MODULES[r.params.view] && r.params.view !== "content") {
        state.view = r.params.view
        state.feature = null
    }
    // canonicalize (adds the locale prefix and the trailing slash)
    if (location.pathname !== r.path) history.replaceState({}, "", r.path + location.search)
    app.classList.remove("open")
    render()
}
window.addEventListener("popstate", applyRoute)
function navigate(view, entity, feature) {
    const to = view === "content" ? "/entity/" + (entity ?? state.entity)
        : view === "settings" && feature ? "/settings/" + feature
        : "/" + view
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
    if (e.key === "Escape") {
        closeDrawer()
        layout.searchbar.hidden = true
    }
    // "/" opens the HEADER search from anywhere (Frappe's awesomebar habit)
    if (e.key === "/" && !/INPUT|SELECT|TEXTAREA/.test(document.activeElement?.tagName ?? "")) {
        e.preventDefault()
        toggleSearch(true)
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
checkSession()
