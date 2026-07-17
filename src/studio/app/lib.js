/**
 * Studio kit — the shared primitives every module builds on (the akao/Directus
 * principle: separate concerns, reuse everywhere). No framework: small DOM
 * helpers, an authenticated API client, the i18n resolver, and the theme
 * controller. Modules never fetch or build DOM ad-hoc; they use these.
 */

// ── DOM ────────────────────────────────────────────────────────────────────────
export const $ = (id) => document.getElementById(id)
export const el = (tag, props = {}, kids = []) => {
    const node = document.createElement(tag)
    for (const [k, v] of Object.entries(props)) {
        if (k === "class") node.className = v
        else if (k === "style") node.setAttribute("style", v)
        else if (k === "html") node.innerHTML = v
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v)
        else if (k === "text") node.textContent = v
        else node[k] = v
    }
    for (const kid of [].concat(kids)) if (kid != null) node.append(kid)
    return node
}

/** Non-blocking toast (replaces alert()). type: "ok" | "err". */
export function toast(message, type = "ok") {
    let host = $("nx-toasts")
    if (!host) { host = el("div", { id: "nx-toasts", class: "nx-toasts" }); document.body.append(host) }
    const node = el("div", { class: "nx-toast " + type, text: message })
    host.append(node)
    setTimeout(() => { node.style.opacity = "0"; setTimeout(() => node.remove(), 220) }, 3400)
}

// ── API client (carries the session token; 401 → onUnauthorized) ───────────────
export function createApi({ onUnauthorized } = {}) {
    let token = localStorage.getItem("nexus-token") || null
    const headers = () => ({ "content-type": "application/json", ...(token ? { authorization: "Bearer " + token } : {}) })
    async function req(method, path, body) {
        const res = await fetch(path, { method, headers: headers(), body: body === undefined ? undefined : JSON.stringify(body) })
        if (res.status === 401 && onUnauthorized) onUnauthorized()
        return res.json()
    }
    return {
        get token() { return token },
        setToken(t) { token = t; t ? localStorage.setItem("nexus-token", t) : localStorage.removeItem("nexus-token") },
        get: (p) => req("GET", p),
        post: (p, b) => req("POST", p, b),
        // domain helpers — the auto-generated API, one place
        list: (entity, filter) => req("POST", `/api/v1/${entity}/query`, { filter, limit: 100 }),
        create: (entity, data) => req("POST", `/api/v1/${entity}`, data),
        ask: (entity, query) => req("POST", `/api/v1/${entity}/ask`, { query, limit: 100 }),
        search: (entity, query) => req("POST", `/api/v1/${entity}/search`, { query, mode: "hybrid" }),
        session: () => req("GET", "/_studio/session"),
        studio: (name, method, body) => req(method, "/_studio/" + name, body)
    }
}

// ── i18n (resolves the served translation memory) ──────────────────────────────
export function createI18n(bundle) {
    const dict = bundle?.dict ?? {}
    const names = bundle?.names ?? {}
    const locales = bundle?.locales ?? ["en"]
    let locale = localStorage.getItem("nexus-locale")
    const guess = (navigator.language || "en").slice(0, 2)
    if (!locales.includes(locale)) locale = locales.includes(guess) ? guess : "en"
    const t = (key, fallback) => {
        const entry = dict[key]
        const v = entry && (entry[locale] != null ? entry[locale] : entry.en)
        return v != null ? v : fallback != null ? fallback : key
    }
    return {
        t, locales, names,
        get locale() { return locale },
        set(next) { locale = next; localStorage.setItem("nexus-locale", next); document.documentElement.lang = next }
    }
}

// ── theme (light / dark / auto) ────────────────────────────────────────────────
const THEMES = ["auto", "light", "dark"]
export function createTheme() {
    let theme = localStorage.getItem("nexus-theme") || "auto"
    const apply = () => {
        if (theme === "auto") document.documentElement.removeAttribute("data-theme")
        else document.documentElement.setAttribute("data-theme", theme)
    }
    apply()
    return {
        get value() { return theme },
        icon: () => (theme === "dark" ? "🌙" : theme === "light" ? "☀️" : "🌗"),
        cycle() { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; localStorage.setItem("nexus-theme", theme); apply(); return theme }
    }
}
