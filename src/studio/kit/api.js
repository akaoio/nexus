/**
 * The authenticated Studio API client — carries the session token, funnels
 * every request through one fetch seam, and maps the auto-generated
 * instance API (query/create/update/ask/search) plus the /_studio panel
 * endpoints. 401 fires onUnauthorized so the shell can raise the login.
 */

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
        update: (entity, id, data) => req("PATCH", `/api/v1/${entity}/${id}`, data),
        remove: (entity, id) => req("DELETE", `/api/v1/${entity}/${id}`),
        ask: (entity, query) => req("POST", `/api/v1/${entity}/ask`, { query, limit: 100 }),
        search: (entity, query) => req("POST", `/api/v1/${entity}/search`, { query, mode: "hybrid" }),
        session: () => req("GET", "/_studio/session"),
        studio: (name, method, body) => req(method, "/_studio/" + name, body)
    }
}

export default { createApi }
