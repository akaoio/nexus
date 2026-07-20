/**
 * Auto-generated HTTP API — the transport skin over the Data Plane
 * (ARCHITECTURE.md §5). The contract is part of App API v1: the version
 * lives in the URL, internal apps and external clients speak the SAME
 * endpoints, and this layer contains NO permission or validation logic —
 * the Data Plane already enforces everything; HTTP only translates.
 *
 * Endpoints (per entity, from its Model schema):
 *   GET    /api/v1/:entity            list — ?limit=&offset=&order=field:dir
 *   POST   /api/v1/:entity            create (JSON body)
 *   POST   /api/v1/:entity/query      list with a full Query AST document:
 *                                     { filter?, limit?, offset?, orderBy? }
 *   GET    /api/v1/:entity/:id        read one
 *   PATCH  /api/v1/:entity/:id        update (JSON body)
 *   DELETE /api/v1/:entity/:id        remove
 *
 * Responses: { ok: true, data } | { ok: false, error: { code, message } }.
 * Status mapping: 201 create · 200 otherwise · 400 validation ·
 * 403 E_FORBIDDEN/E_FORBIDDEN_ROW/E_FIELD_FORBIDDEN · 404 E_NOT_FOUND/
 * E_ENTITY (and null get) · 413 oversized body · 500 non-domain errors.
 */

const BODY_LIMIT = 1024 * 1024 // 1MB

const STATUS = {
    E_AUTH: 401,
    E_FORBIDDEN: 403,
    E_FORBIDDEN_ROW: 403,
    E_FIELD_FORBIDDEN: 403,
    E_NOT_FOUND: 404,
    E_ENTITY: 404
}

const codeOf = (error) => {
    const match = String(error?.message || "").match(/^(E_[A-Z_]+)/)
    return match ? match[1] : null
}

function send(res, status, body) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" })
    res.end(JSON.stringify(body))
}

const ok = (res, data, status = 200) => send(res, status, { ok: true, data })

function fail(res, error) {
    const code = codeOf(error)
    const status = code ? (STATUS[code] ?? 400) : 500
    send(res, status, { ok: false, error: { code: code ?? "E_INTERNAL", message: error?.message || "internal error" } })
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = []
        let size = 0
        req.on("data", (chunk) => {
            size += chunk.length
            if (size > BODY_LIMIT) {
                reject(new Error("E_BODY_SIZE: request body exceeds 1MB"))
                req.destroy()
                return
            }
            chunks.push(chunk)
        })
        req.on("end", () => {
            const text = Buffer.concat(chunks).toString("utf8")
            if (!text) return resolve({})
            try {
                resolve(JSON.parse(text))
            } catch {
                reject(new Error("E_JSON: request body is not valid JSON"))
            }
        })
        req.on("error", reject)
    })
}

function listOptions(searchParams) {
    const options = {}
    if (searchParams.has("limit")) options.limit = Number(searchParams.get("limit"))
    if (searchParams.has("offset")) options.offset = Number(searchParams.get("offset"))
    if (searchParams.has("order"))
        options.orderBy = searchParams
            .get("order")
            .split(",")
            .filter(Boolean)
            .map((part) => {
                const [field, dir] = part.split(":")
                return dir ? { field, dir } : { field }
            })
    return options
}

/**
 * Build the request handler.
 * @param {Object} config
 * @param {import("../Data.js").DataPlane} config.plane
 * @param {(req) => Object} config.context - Resolves a request into a Data
 *   Plane ctx { user, roles, policies, shares } — the auth layer's seam
 * @param {string} [config.base] - URL prefix (default /api/v1)
 * @param {Object} [config.events] - the realtime event hub (createEventHub()),
 *   or null when realtime is not enabled — mounts GET /api/v1/_events
 * @returns {(req, res) => Promise<boolean>} true when the request was handled
 */
export function createApi({ plane, context, base = "/api/v1", endpoints = [], events = null }) {
    return async function handle(req, res) {
        const url = new URL(req.url, "http://localhost")
        if (url.pathname !== base && !url.pathname.startsWith(base + "/")) return false

        const segments = url.pathname.slice(base.length).split("/").filter(Boolean)
        try {
            // The realtime stream (design 2026-07-20 §1). EventSource cannot
            // set headers, so this ONE endpoint also accepts ?token= — it is
            // folded into the normal auth seam before context() runs.
            if (segments[0] === "_events" && req.method === "GET") {
                if (!events) throw new Error("E_NOT_FOUND: realtime is not enabled")
                const token = url.searchParams.get("token")
                if (token && !req.headers["authorization"] && !req.headers["x-nexus-key"]) {
                    req.headers["authorization"] = "Bearer " + token
                    req.headers["x-nexus-key"] = token
                }
                const ctx = context(req)
                const entities = url.searchParams.get("entities")
                events.subscribe({ res, ctx, entities: entities ? entities.split(",").filter(Boolean) : null })
                return true // the connection stays open — no ok()/end()
            }

            const ctx = context(req)
            const [entity, tail] = segments
            if (!entity) throw new Error("E_ENTITY: missing entity in path")

            // App endpoints — the "_" namespace can never collide with an entity
            if (entity === "_") {
                const path = segments.slice(1).join("/")
                const endpoint = endpoints.find((e) => e.method === req.method && e.path === path)
                if (!endpoint) throw new Error(`E_NOT_FOUND: no endpoint ${req.method} /_/${path}`)
                const body = req.method === "GET" || req.method === "DELETE" ? {} : await readBody(req)
                return ok(res, await endpoint.handler({ req, url, body, ctx, plane })), true
            }

            if (!tail) {
                if (req.method === "GET") return ok(res, await plane.list(entity, listOptions(url.searchParams), ctx)), true
                if (req.method === "POST") return ok(res, await plane.create(entity, await readBody(req), ctx), 201), true
                throw new Error("E_METHOD: unsupported method")
            }

            if (tail === "search" && req.method === "POST") {
                const body = await readBody(req)
                return ok(res, await plane.search(entity, body, ctx)), true
            }

            if (tail === "ask" && req.method === "POST") {
                const body = await readBody(req)
                return ok(res, await plane.ask(entity, body.query ?? "", ctx, { limit: body.limit })), true
            }

            if (tail === "query" && req.method === "POST") {
                const body = await readBody(req)
                const options = {}
                if (body.filter !== undefined) options.filter = body.filter
                if (body.limit !== undefined) options.limit = body.limit
                if (body.offset !== undefined) options.offset = body.offset
                if (body.orderBy !== undefined) options.orderBy = body.orderBy
                return ok(res, await plane.list(entity, options, ctx)), true
            }

            if (segments.length === 2) {
                const id = tail
                if (req.method === "GET") {
                    const row = await plane.get(entity, id, ctx)
                    if (row === null) throw new Error(`E_NOT_FOUND: ${entity}/${id}`)
                    return ok(res, row), true
                }
                if (req.method === "PATCH") return ok(res, await plane.update(entity, id, await readBody(req), ctx)), true
                if (req.method === "DELETE") return ok(res, { removed: await plane.remove(entity, id, ctx) }), true
            }
            throw new Error("E_METHOD: unsupported method or path")
        } catch (error) {
            fail(res, error)
            return true
        }
    }
}
