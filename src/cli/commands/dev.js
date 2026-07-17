/**
 * nexus dev — serve the current instance over HTTP: the auto-generated Data
 * Plane API under /api/v1, the Studio admin UI, plus /_studio write endpoints
 * and static public/ files. Zero dependencies: Node's http + node:sqlite (the
 * akao dev.js lineage — no NGINX, no Redis, no Supervisor).
 *
 * DEV IDENTITY — deliberate and loud: when no auth is configured this server
 * grants a wide-open DEV policy to a single dev user (overridable via the
 * x-nexus-user header). Configuring api_keys/identities makes auth required.
 * `nexus start` (production) refuses the DEV identity entirely.
 */

import { createServer } from "http"
import { existsSync, readFileSync, statSync, writeFileSync, mkdirSync } from "fs"
import { join, resolve, extname, sep } from "path"
import { loadInstance } from "../instance.js"
import { buildInstanceApi } from "../../http/instance-server.js"
import { studioIndex } from "../studio-index.js"
import { validate } from "../../model/Model.js"
import { loadDictionary, mergeDictionaries, coveredLocales } from "../../i18n/i18n.js"
import { verifyChallenge, issueToken, verifyToken } from "../../app/auth.js"
import { listUsers, addUser, removeUser, setRoles } from "../../app/users.js"
import { MODELS, status as modelStatus, withModel } from "../../app/models.js"
import { redact, setPath, unsetPath } from "../../app/config.js"
import { randomBytes } from "crypto"
import { fileURLToPath } from "url"
import { Router } from "../../kernel/Router.js"

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon",
    ".md": "text/plain; charset=utf-8"
}

// The Nexus package root — /_nexus/src/* serves the framework's own modules
// (Studio components, kernel UI) to instance pages
// fileURLToPath, not .pathname — the latter yields "/C:/…" on Windows, which resolve() mangles
const NEXUS_ROOT = fileURLToPath(new URL("../../..", import.meta.url))

export async function dev(args, flags, out) {
    const root = process.cwd()
    if (!existsSync(join(root, "nexus.config.json"))) {
        out.error("Not a Nexus instance (no nexus.config.json here)", { code: "E_NO_INSTANCE" })
        process.exitCode = 1
        return
    }

    const port = flags.port !== undefined ? Number(flags.port) : 8080
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        out.error(`Invalid port: ${flags.port}`, { code: "E_USAGE" })
        process.exitCode = 2
        return
    }

    // Load and validate the instance — broken schemas are refused, not served
    const { config, schemas, apps, policies: appPolicies } = loadInstance(root)
    const appName = apps[0]?.dir ?? "app"
    // i18n (§5.1): the framework's Studio strings + any instance i18n/*.yaml,
    // merged into one translation memory the UI resolves at render time.
    const fw = loadDictionary(join(NEXUS_ROOT, "src/i18n/dict"))
    const inst = loadDictionary(join(root, "i18n"))
    const i18n = {
        dict: mergeDictionaries(fw.dict, inst.dict),
        names: { ...fw.locales, ...inst.locales }
    }
    i18n.locales = coveredLocales(i18n.dict)
    // Data Plane + auth + API through the shared wiring. Dev mode falls back to
    // the loud DEV identity when no auth is configured (production refuses that).
    const { api, authState, challenges, engine, authMode, embedderInfo } = await buildInstanceApi({ root, config, schemas, apps, appPolicies, mode: "dev" })
    const studioAuthAtBoot = authState.required

    const json = (res, code, obj) => {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" })
        res.end(JSON.stringify(obj))
    }
    const readJson = (req) =>
        new Promise((resolve) => {
            let raw = ""
            req.on("data", (c) => {
                raw += c
                if (raw.length > 262144) req.destroy()
            })
            req.on("end", () => {
                try {
                    resolve(JSON.parse(raw || "{}"))
                } catch {
                    resolve(null)
                }
            })
        })

    // The Studio's route table — the same patterns the client router uses.
    const STUDIO_ROUTES = ["/entity/[entity]", "/[view]"]
    const STUDIO_VIEWS = new Set(["entity", "permissions", "users", "ai", "settings", "search"])
    function routeMatches(pathname) {
        if (/\.[^/]+$/.test(pathname) || pathname.includes("/.")) return false // files + dotpaths are never routes
        const locales = i18n.locales.map((code) => ({ code }))
        const r = Router.process({ path: pathname, routes: STUDIO_ROUTES, locales })
        // "home" covers both the root and unmatched leftovers — tell them apart
        const segments = pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean)
        if (segments.length && (i18n.locales.includes(segments[0]) || /^[a-z]{2}(-[A-Z]{2})?$/.test(segments[0]))) segments.shift()
        if (!segments.length) return true // "/" or a bare locale prefix
        if (r.route === "/entity/[entity]") return schemas.some((s) => s.name === r.params.entity)
        if (r.route === "/[view]") return STUDIO_VIEWS.has(r.params.view)
        return false
    }

    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://localhost")

        // Observability: one line per request on stderr (stdout stays clean for
        // --json). Timed at response finish so the status and latency are real.
        const started = Date.now()
        res.on("finish", () => process.stderr.write(`  ${req.method} ${url.pathname} ${out.dim("→")} ${res.statusCode} ${out.dim(`${Date.now() - started}ms`)}\n`))

        // Liveness/readiness — always available, no auth, cheap.
        if (url.pathname === "/_health") {
            return json(res, 200, { ok: true, data: { status: "ok", entities: schemas.map((s) => s.name), engine, uptime: Math.round(process.uptime()) } })
        }

        // ZEN auth handshake — issue a nonce, verify a signature, mint a token.
        if (authState.secret && url.pathname === "/api/v1/_auth/challenge" && req.method === "POST") {
            const nonce = randomBytes(24).toString("base64url")
            challenges.set(nonce, Date.now() + 60000)
            return json(res, 200, { ok: true, data: { nonce } })
        }
        if (authState.secret && url.pathname === "/api/v1/_auth/verify" && req.method === "POST") {
            const b = await readJson(req)
            if (!b || typeof b.pub !== "string") return json(res, 400, { ok: false, error: { code: "E_REQUEST" } })
            const expiry = challenges.get(b.nonce)
            if (!expiry || expiry < Date.now()) return json(res, 401, { ok: false, error: { code: "E_CHALLENGE", message: "no live challenge" } })
            challenges.delete(b.nonce) // one-time use
            if (!(await verifyChallenge(b.pub, b.nonce, b.signature)))
                return json(res, 401, { ok: false, error: { code: "E_AUTH", message: "signature does not prove the key" } })
            const roles = authState.rolesForPub(b.pub)
            const token = issueToken({ user: b.pub, roles }, authState.secret)
            return json(res, 200, { ok: true, data: { token, roles } })
        }

        // Studio writes (DEV-ONLY): persist a content type or a permission set
        // the admin UI edited. Editing the schema is a dev activity (Strapi
        // parity) — `nexus start` never exposes these routes.
        // When the server BOOTED with auth on, every /_studio route except the
        // whoami probe needs a signed-in identity. A session that booted open
        // stays open until restart (adding identities flips the DATA API live,
        // but not the studio surface you are configuring it from).
        if (url.pathname.startsWith("/_studio/") && url.pathname !== "/_studio/session" && studioAuthAtBoot) {
            const authz = req.headers["authorization"] ?? ""
            const claims = authz.startsWith("Bearer ") ? verifyToken(authz.slice(7), authState.secret) : null
            if (!claims) return json(res, 401, { ok: false, error: { code: "E_AUTH", message: "sign in to use the Studio" } })
        }
        if (url.pathname === "/_studio/model" && req.method === "POST") {
            const doc = await readJson(req)
            if (!doc || typeof doc.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(doc.name))
                return json(res, 400, { ok: false, error: { code: "E_NAME", message: "a lowercase collection name is required" } })
            const model = { schemaVersion: 1, ...doc }
            const result = validate(model)
            if (!result.valid) return json(res, 400, { ok: false, error: { code: "E_INVALID", message: JSON.stringify(result.errors) } })
            try {
                const dir = join(root, "apps", appName, "models")
                mkdirSync(dir, { recursive: true })
                writeFileSync(join(dir, model.name + ".json"), JSON.stringify(model, null, 4))
                return json(res, 200, { ok: true, data: { name: model.name, restart: true } })
            } catch (error) {
                return json(res, 500, { ok: false, error: { code: "E_WRITE", message: error.message } })
            }
        }
        // The Studio-managed policy set: what the editor loads and saves.
        // devMode tells the UI to say, honestly, that policies only bite once
        // auth is on (the DEV identity is wide-open by design).
        if (url.pathname === "/_studio/permissions" && req.method === "GET") {
            const file = join(root, "apps", appName, "permissions", "studio.json")
            let policies = []
            try { policies = JSON.parse(readFileSync(file, "utf8")) } catch {}
            return json(res, 200, { ok: true, data: { policies, devMode: !authState.required, live: appPolicies.length } })
        }
        if (url.pathname === "/_studio/permissions" && req.method === "POST") {
            const body = await readJson(req)
            if (!body || !Array.isArray(body.policies)) return json(res, 400, { ok: false, error: { code: "E_REQUEST" } })
            try {
                const dir = join(root, "apps", appName, "permissions")
                mkdirSync(dir, { recursive: true })
                writeFileSync(join(dir, "studio.json"), JSON.stringify(body.policies, null, 4))
                // hot-apply: reload every app's policies into the LIVE array the
                // request contexts read — no restart, immediately enforced
                const fresh = loadInstance(root).policies
                appPolicies.length = 0
                appPolicies.push(...fresh)
                return json(res, 200, { ok: true, data: { count: body.policies.length, applied: true } })
            } catch (error) {
                return json(res, 500, { ok: false, error: { code: "E_WRITE", message: error.message } })
            }
        }

        // Studio session (whoami) — tells the UI whether login is required and,
        // from a Bearer token, who is signed in.
        if (url.pathname === "/_studio/session" && req.method === "GET") {
            let signed = null
            const authz = req.headers["authorization"]
            if (authz?.startsWith("Bearer ")) signed = verifyToken(authz.slice(7), authState.secret)
            return json(res, 200, { ok: true, data: { authRequired: authState.required, user: signed?.user ?? null, roles: signed?.roles ?? [] } })
        }
        // Studio user management (DEV-ONLY) — list/add/remove/role identities in
        // nexus.config.json. Applied on restart (which rebuilds auth). Adding an
        // identity turns on required auth.
        if (url.pathname === "/_studio/users" && req.method === "GET") {
            const cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
            return json(res, 200, { ok: true, data: { identities: listUsers(cfg), authRequired: authState.required } })
        }
        if (url.pathname === "/_studio/users" && req.method === "POST") {
            const body = await readJson(req)
            if (!body || typeof body.action !== "string") return json(res, 400, { ok: false, error: { code: "E_REQUEST" } })
            try {
                const cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
                let next = listUsers(cfg)
                if (body.action === "add") next = addUser(next, { pub: body.pub, name: body.name, roles: body.roles ?? [] })
                else if (body.action === "remove") next = removeUser(next, body.pub)
                else if (body.action === "role") next = setRoles(next, body.pub, body.roles ?? [])
                else return json(res, 400, { ok: false, error: { code: "E_ACTION" } })
                writeFileSync(join(root, "nexus.config.json"), JSON.stringify({ ...cfg, identities: next }, null, 4) + "\n")
                // hot-apply: the auth layer reads this live array per request —
                // adding the first identity turns required auth ON immediately
                if (authState.identities) {
                    authState.identities.length = 0
                    authState.identities.push(...next)
                }
                return json(res, 200, { ok: true, data: { identities: next, applied: true, authRequired: authState.required } })
            } catch (error) {
                return json(res, 400, { ok: false, error: { code: error.message.split(":")[0], message: error.message } })
            }
        }

        // Studio AI panel (DEV-ONLY): the site's embedding model status, and
        // switching it. Weights are pulled from the terminal (`nexus model
        // pull`) — a multi-minute download has no business blocking a request.
        if (url.pathname === "/_studio/ai" && req.method === "GET") {
            const cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
            return json(res, 200, { ok: true, data: { ...modelStatus(cfg, root), models: MODELS } })
        }
        if (url.pathname === "/_studio/ai" && req.method === "POST") {
            const body = await readJson(req)
            const cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
            writeFileSync(join(root, "nexus.config.json"), JSON.stringify(withModel(cfg, body?.model || null), null, 4) + "\n")
            return json(res, 200, { ok: true, data: { model: body?.model || null, restart: true } })
        }

        // Studio settings (DEV-ONLY): read the (redacted) config and set/unset
        // any dot-path — the same safe editing as `nexus config`. Restart applies.
        if (url.pathname === "/_studio/config" && req.method === "GET") {
            const cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
            return json(res, 200, { ok: true, data: { config: redact(cfg) } })
        }
        if (url.pathname === "/_studio/config" && req.method === "POST") {
            const body = await readJson(req)
            if (!body || typeof body.key !== "string") return json(res, 400, { ok: false, error: { code: "E_REQUEST" } })
            const cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
            const next = body.remove ? unsetPath(cfg, body.key) : setPath(cfg, body.key, body.value)
            writeFileSync(join(root, "nexus.config.json"), JSON.stringify(next, null, 4) + "\n")
            return json(res, 200, { ok: true, data: { restart: true } })
        }

        if (api && (await api(req, res))) return

        // SPA routes (akao build-thinking: routes are data, shared with the
        // client): /, /vi/, /en/entity/task, /permissions … all serve the SAME
        // shell — but ONLY paths that precisely match a known route with a
        // known value. File-looking paths and dotfiles never reach the shell
        // (SEC-01..04 hold: /nexus.config.json, /.nexus/*, backups stay 404).
        if (routeMatches(url.pathname)) {
            res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-cache" })
            return res.end(studioIndex(config, schemas, { embedder: embedderInfo, appName, i18n }))
        }
        // Statics (the akao statics discipline): YAML in src is the human+machine
        // source; what ships is JSON — composed at request time, no build step,
        // no duplication. Components LOAD these; they never hardcode.
        if (url.pathname === "/_nexus/statics/locales.json") {
            const registry = i18n.names // src/i18n/dict/locales.yaml, already parsed
            const list = i18n.locales.map((code) => ({ code, name: registry[code] ?? code }))
            res.writeHead(200, { "content-type": MIME[".json"], "cache-control": "no-cache" })
            return res.end(JSON.stringify(list))
        }
        // The Studio stylesheet is COMPOSED from the css modules (akao triad
        // layout) at request time — single source of truth, no build step.
        if (url.pathname === "/_nexus/src/studio/app/studio.css") {
            const { pageStyles } = await import("../../studio/css/page.css.js")
            res.writeHead(200, { "content-type": MIME[".css"], "cache-control": "no-cache" })
            return res.end(pageStyles)
        }
        // Framework modules for instance pages — /_nexus/{src,vendor}/* only,
        // resolved inside the Nexus package, traversal-guarded. vendor/ is
        // needed because Studio components (e.g. the schema designer) import
        // the data layer, which imports the vendored Kysely.
        if (url.pathname.startsWith("/_nexus/")) {
            // decode %5B…%5D — akao-style [param] route folders live on disk
            const path = resolve(NEXUS_ROOT, "." + decodeURIComponent(url.pathname).slice("/_nexus".length))
            const allowed = path.startsWith(join(NEXUS_ROOT, "src")) || path.startsWith(join(NEXUS_ROOT, "vendor"))
            if (!allowed || !existsSync(path) || !statSync(path).isFile()) {
                res.writeHead(404, { "content-type": "text/plain" })
                return res.end("Not found")
            }
            // no-cache: the browser must revalidate framework modules on reload —
            // heuristic caching would pin a STALE Studio after every code change
            res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream", "cache-control": "no-cache" })
            return res.end(readFileSync(path))
        }
        // Static files — SECURITY (SEC-01..04): served ONLY from <root>/public/,
        // never from the instance root (which holds config with api_keys, the
        // database and backups). The startsWith guard keeps traversal inside it.
        const publicDir = join(root, "public")
        const path = resolve(publicDir, "." + url.pathname)
        if (path !== publicDir && !path.startsWith(publicDir + sep)) {
            res.writeHead(404, { "content-type": "text/plain" })
            return res.end("Not found")
        }
        if (!existsSync(path) || !statSync(path).isFile()) {
            res.writeHead(404, { "content-type": "text/plain" })
            return res.end("Not found")
        }
        res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" })
        res.end(readFileSync(path))
    })

    await new Promise((ready, failed) => {
        server.once("error", failed)
        server.listen(port, ready)
    })
    const actual = server.address().port
    const url = `http://localhost:${actual}`
    out.print(`${out.green("⬡")} Nexus dev · ${out.cyan(url)}  ${out.dim("(Ctrl+C to stop)")}`)
    if (schemas.length) {
        out.print(`  ${out.dim("api")}    ${url}/api/v1/${schemas[0].name} ${out.dim(`(+ ${schemas.length - 1} more)`)}`)
        out.print(`  ${out.dim("auth")}   ${out.yellow(authMode)}`)
        out.print(`  ${out.dim("data")}   engine ${engine}${engine === "sqlite" ? " · .nexus/data.db" : ""}`)
        out.print(`  ${out.dim("embed")}  ${embedderInfo.mode}${embedderInfo.name ? ` · ${embedderInfo.name}` : ""}`)
    }
    out.emit({ ok: true, url, port: actual, entities: schemas.map((s) => s.name) })
    return server
}
