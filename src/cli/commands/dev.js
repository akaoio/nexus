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
import { buildInstanceApi, NEXUS_CTX_POLICIES } from "../../core/HTTP/server.js"
import { studioIndex } from "../../studio/layouts/studio/shell.js"
import { validate } from "../../core/Model.js"
import { loadDictionary, mergeDictionaries, coveredLocales } from "../../i18n/i18n.js"
import { verifyChallenge, issueToken, verifyToken } from "../../core/App/auth.js"
import { listUsers, addUser, removeUser, setRoles } from "../../core/App/users.js"
import { MODELS, NL_MODELS, status as modelStatus, withModel, withNlModel, currentModel, currentNlModel } from "../../core/App/models.js"
import { redact, setPath, unsetPath } from "../../core/App/config.js"
import { randomBytes } from "crypto"
import { fileURLToPath } from "url"
import { Router } from "../../core/Router.js"
import { createWatcher, devMessage } from "../../core/HMR/watch.js"
import { accessFor } from "../dev-access.js"

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
    let { config, schemas, apps, policies: appPolicies, files: schemaFiles } = loadInstance(root)
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
    let { api, plane, authState, challenges, engine, authMode, embedderInfo, policyLayers, effects } = await buildInstanceApi({ root, config, schemas, apps, appPolicies, mode: "dev" })
    const studioAuthAtBoot = authState.required

    // ── hot reload — entity writes NEVER require a dev restart ──────────────
    // Reloading swaps the whole instance surface (schemas, plane, API) in
    // place; every request closure reads these let-bindings, so the very next
    // request runs on the new shape. The old sqlite handle is left to the GC —
    // a dev-only cost, taken deliberately for restartless entity CRUD.
    async function reloadInstance() {
        await effects.stop() // stop the old interval + job thread before the rebuild replaces the plane
        const fresh = loadInstance(root)
        config = fresh.config
        schemas = fresh.schemas
        apps = fresh.apps
        schemaFiles = fresh.files
        appPolicies.length = 0
        appPolicies.push(...fresh.policies)
        ;({ api, plane, authState, challenges, engine, authMode, embedderInfo, policyLayers, effects } = await buildInstanceApi({ root, config, schemas, apps, appPolicies, mode: "dev" }))
    }

    // ── dev tooling stream (design 2026-07-20 §3): the server half of the
    // shipped akao HMR client. Dev-only; `nexus start` never mounts this.
    // No SIGINT/SIGTERM teardown exists in dev.js today (unlike start.js) —
    // the watcher's lifetime is the process's; the spawned dev process is
    // SIGKILLed by callers/tests, which reaps it along with everything else.
    const devSubscribers = new Set()
    const devBroadcast = (message) => {
        const data = typeof message === "string" ? message : JSON.stringify(message)
        for (const res of [...devSubscribers]) {
            try { res.write(`data:${data}\n\n`) } catch { devSubscribers.delete(res); try { res.end() } catch {} }
        }
    }
    // dirs→message scheme (design 2026-07-20 §3, HMR-03): framework hits ride
    // their servable /_nexus URLs; apps/ has no HTTP route (SEC discipline),
    // so an apps/ change is an honest full reload, never an unresolvable
    // hmr path. devMessage() is the pure, unit-tested clause; this closure
    // only supplies which root means what.
    const watcher = createWatcher({
        dirs: [join(NEXUS_ROOT, "src", "studio"), join(NEXUS_ROOT, "src", "core"), join(root, "apps")],
        onChange: (change) => {
            // NEXUS_ROOT (from fileURLToPath of a directory URL) carries a
            // trailing separator; devMessage's dir comparison is exact, so
            // strip it here rather than fuzz the pure helper's match rule.
            const nexusRoot = NEXUS_ROOT.replace(/[\\/]+$/, "")
            const msg = devMessage(change, { nexusRoot, appsDir: join(root, "apps") })
            if (msg) devBroadcast(msg)
        }
    })

    // internal plane context for _studio reads/executions (dev-only surface)
    const nexusCtx = (entity, actions) => ({ user: "nexus", roles: [], shares: [], policies: [{ entity, actions, rule: null, permlevel: 0, ifOwner: false }] })
    // internal plane context for DIRECTORY writes specifically (item 2, issue
    // #9 final review): /_studio/users provisions through nexus.config.json
    // AND the nexus_user row now that the row is the truth past first boot —
    // it needs the SAME permlevel-1 grant on nexus_user.roles the admin
    // bundle carries (C1, SYS-10), so it reuses the exact policy set the
    // server's own internal directory actor uses (NEXUS_CTX_POLICIES),
    // rather than hand-rolling a parallel one that can drift from it.
    const nexusUserCtx = { user: "nexus", roles: [], shares: [], policies: NEXUS_CTX_POLICIES }

    const json = (res, code, obj) => {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" })
        res.end(JSON.stringify(obj))
    }
    // BODY_LIMIT (issue #9 I2): the old cap here destroyed the request past
    // 256KB but never resolved the promise — "end" never fires after
    // destroy(), so the handler hung forever instead of answering. Same
    // sentinel fix as start.js/api.js: resolve immediately, never hang.
    const BODY_LIMIT = 1024 * 1024 // 1MB — aligned with api.js's authenticated limit
    // CHALLENGE_CAP (issue #9 I3): swept on insert + capped, same as start.js.
    const CHALLENGE_CAP = 1000
    const readJson = (req) =>
        new Promise((resolve) => {
            let raw = ""
            let size = 0
            req.on("data", (c) => {
                size += c.length
                // sentinel, not a hang — and NOT req.destroy() here: destroying
                // the request kills the underlying socket immediately, taking
                // the response down with it before the call site can write the
                // 413 (destroy happens AFTER the response, at the call site)
                if (size > BODY_LIMIT) resolve(Symbol.for("E_BODY_SIZE"))
                else raw += c
            })
            req.on("end", () => {
                try {
                    resolve(JSON.parse(raw || "{}"))
                } catch {
                    resolve(null)
                }
            })
            req.on("error", () => resolve(null))
        })

    // The Studio's route table — the same patterns the client router uses.
    const STUDIO_ROUTES = ["/entity/[entity]", "/settings/[feature]", "/[view]"]
    const STUDIO_VIEWS = new Set(["entities", "entity", "permissions", "roles", "users", "jobs", "settings", "search"]) // "entity" = legacy redirect
    const STUDIO_SETTINGS = new Set(["ai", "locales", "themes"])
    function routeMatches(pathname) {
        if (/\.[^/]+$/.test(pathname) || pathname.includes("/.")) return false // files + dotpaths are never routes
        const locales = i18n.locales.map((code) => ({ code }))
        const r = Router.process({ path: pathname, routes: STUDIO_ROUTES, locales })
        // "home" covers both the root and unmatched leftovers — tell them apart
        const segments = pathname.replace(/^\/+|\/+$/g, "").split("/").filter(Boolean)
        if (segments.length && (i18n.locales.includes(segments[0]) || /^[a-z]{2}(-[A-Z]{2})?$/.test(segments[0]))) segments.shift()
        if (!segments.length) return true // "/" or a bare locale prefix
        if (r.route === "/entity/[entity]") return schemas.some((s) => s.name === r.params.entity)
        if (r.route === "/settings/[feature]") return STUDIO_SETTINGS.has(r.params.feature)
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

        // Dev tooling stream — the server half of the shipped HMR client
        // (core/HMR/client.js). Dev-only: `nexus start` never mounts this.
        if (url.pathname === "/__dev_events" && req.method === "GET") {
            res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", "connection": "keep-alive" })
            res.write(":connected\n\n")
            devSubscribers.add(res)
            const off = () => { devSubscribers.delete(res) }
            req.on("close", off)
            res.on("error", off)
            return
        }

        // ZEN auth handshake — issue a nonce, verify a signature, mint a token.
        if (authState.secret && url.pathname === "/api/v1/_auth/challenge" && req.method === "POST") {
            // sweep expired entries first (issue #9 I3) so a steady flood cannot
            // pin the cap forever, then cap rather than growing unbounded
            for (const [n, exp] of challenges) if (exp < Date.now()) challenges.delete(n)
            if (challenges.size >= CHALLENGE_CAP)
                return json(res, 503, { ok: false, error: { code: "E_BUSY", message: "too many pending challenges" } })
            const nonce = randomBytes(24).toString("base64url")
            challenges.set(nonce, Date.now() + 60000)
            return json(res, 200, { ok: true, data: { nonce } })
        }
        if (authState.secret && url.pathname === "/api/v1/_auth/verify" && req.method === "POST") {
            const b = await readJson(req)
            if (b === Symbol.for("E_BODY_SIZE")) {
                json(res, 413, { ok: false, error: { code: "E_BODY_SIZE" } })
                req.destroy() // AFTER the response — see readJson's comment
                return
            }
            if (!b || typeof b.pub !== "string") return json(res, 400, { ok: false, error: { code: "E_REQUEST" } })
            const expiry = challenges.get(b.nonce)
            if (!expiry || expiry < Date.now()) return json(res, 401, { ok: false, error: { code: "E_CHALLENGE", message: "no live challenge" } })
            challenges.delete(b.nonce) // one-time use
            if (!(await verifyChallenge(b.pub, b.nonce, b.signature)))
                return json(res, 401, { ok: false, error: { code: "E_AUTH", message: "signature does not prove the key" } })
            if (!authState.knownPub(b.pub))
                return json(res, 401, { ok: false, error: { code: "E_AUTH", message: "this identity is not provisioned on this instance" } })
            const roles = authState.rolesForPub(b.pub)
            const token = issueToken({ user: b.pub, roles }, authState.secret)
            return json(res, 200, { ok: true, data: { token, roles } })
        }

        // Studio writes (DEV-ONLY): persist a content type or a permission set
        // the admin UI edited. Editing the schema is a dev activity (Strapi
        // parity) — `nexus start` never exposes these routes.
        // When the server BOOTED with auth on, every /_studio route needs a
        // signed-in identity EXCEPT the ones STUDIO_ACCESS declares "any" (no
        // route claims that tier today — the former whoami exception moved
        // to GET /api/v1/_session in Task 2, since the login UI needs to ask
        // "is auth on?" in BOTH modes, not just dev). ONE source of truth: this
        // hardcoded `&& url.pathname !== "/_studio/" + someNewPath` here would make
        // that route fully UNAUTHENTICATED, not merely open-to-any-role; the
        // exemption belongs ONLY in dev-access.js's declared table. A session
        // that booted open stays open until restart (adding identities flips
        // the DATA API live, but not the studio surface you are configuring
        // it from).
        if (url.pathname.startsWith("/_studio/") && studioAuthAtBoot && accessFor(url.pathname) !== "any") {
            const authz = req.headers["authorization"] ?? ""
            const claims = authz.startsWith("Bearer ") ? verifyToken(authz.slice(7), authState.secret) : null
            if (!claims) return json(res, 401, { ok: false, error: { code: "E_AUTH", message: "sign in to use the Studio" } })
            // authorization, not just authentication (issue #9 C4): roles come
            // from the LIVE directory, never from the token's own claims
            const roles = authState.rolesForPub(claims.user) ?? []
            if (accessFor(url.pathname) === "admin" && !roles.includes("admin"))
                return json(res, 403, { ok: false, error: { code: "E_FORBIDDEN", message: "the Studio needs the admin role" } })
        }
        if (url.pathname === "/_studio/model" && req.method === "POST") {
            const doc = await readJson(req)
            if (doc === Symbol.for("E_BODY_SIZE")) {
                json(res, 413, { ok: false, error: { code: "E_BODY_SIZE" } })
                req.destroy()
                return
            }
            if (!doc || typeof doc.name !== "string" || !/^[a-z][a-z0-9_]*$/.test(doc.name))
                return json(res, 400, { ok: false, error: { code: "E_NAME", message: "a lowercase collection name is required" } })
            const model = { schemaVersion: 1, ...doc }
            const result = validate(model)
            if (!result.valid) return json(res, 400, { ok: false, error: { code: "E_INVALID", message: JSON.stringify(result.errors) } })
            try {
                const dir = join(root, "apps", appName, "models")
                mkdirSync(dir, { recursive: true })
                writeFileSync(join(dir, model.name + ".json"), JSON.stringify(model, null, 4))
                await reloadInstance() // live: tables ensured, API surface rebuilt
                devBroadcast("reload") // structural change — the client does a full page reload
                return json(res, 200, { ok: true, data: { name: model.name, applied: true } })
            } catch (error) {
                return json(res, 500, { ok: false, error: { code: "E_WRITE", message: error.message } })
            }
        }
        // The entity DIRECTORY the /entities list renders: every loaded schema
        // with its source file, declared views and live row count.
        if (url.pathname === "/_studio/entities" && req.method === "GET") {
            const rows = []
            for (const s of schemas) {
                let count = 0
                try { count = (await plane.list(s.name, {}, nexusCtx(s.name, ["read"]))).length } catch {}
                rows.push({
                    id: s.name, // the list view keys rows by id
                    name: s.name,
                    label: s.label?.en ?? s.name,
                    fields: (s.fields ?? []).length,
                    views: (s.views ?? ["list"]).join(", "),
                    file: schemaFiles[s.name] ?? null,
                    records: count
                })
            }
            return json(res, 200, { ok: true, data: rows })
        }
        // Cascade delete — GET returns the DRY-RUN plan, POST executes it only
        // when the client echoes the entity's name (typed confirmation). The
        // plan is pure core logic; this endpoint merely gathers inputs and,
        // on execute, performs EXACTLY what the plan named.
        if (url.pathname === "/_studio/entity-delete" && (req.method === "GET" || req.method === "POST")) {
            const body = req.method === "POST" ? await readJson(req) : null
            if (body === Symbol.for("E_BODY_SIZE")) {
                json(res, 413, { ok: false, error: { code: "E_BODY_SIZE" } })
                req.destroy()
                return
            }
            const name = req.method === "GET" ? url.searchParams.get("name") : body?.name
            try {
                const { entityDeletePlan } = await import("../../core/App/lifecycle.js")
                const dbPolicyRows = await plane.list("nexus_policy", {}, nexusCtx("nexus_policy", ["read"]))
                const viewRows = await plane.list("nexus_view", {}, nexusCtx("nexus_view", ["read"]))
                let rowCount = 0
                try { rowCount = (await plane.list(name, {}, nexusCtx(name, ["read"]))).length } catch {}
                const plan = entityDeletePlan({
                    target: name,
                    schemas: schemas.map((s) => ({ schema: s, file: schemaFiles[s.name] })),
                    rowCount,
                    dbPolicyRows,
                    baselinePolicies: appPolicies.map((p) => ({ source: "app", ...p })),
                    viewRows
                })
                if (req.method === "GET") return json(res, 200, { ok: true, data: plan })
                if (body?.confirm !== name)
                    return json(res, 400, { ok: false, error: { code: "E_CONFIRM", message: "type the entity name to confirm" } })
                // execute the plan — nothing beyond what it named
                for (const id of plan.dbPolicies) await plane.remove("nexus_policy", id, nexusCtx("nexus_policy", ["read", "delete"]))
                for (const id of plan.views) await plane.remove("nexus_view", id, nexusCtx("nexus_view", ["read", "delete"]))
                for (const drop of plan.linkDrops) {
                    const file = join(root, drop.file)
                    const doc = JSON.parse(readFileSync(file, "utf8"))
                    doc.fields = doc.fields.filter((f) => f.name !== drop.field)
                    writeFileSync(file, JSON.stringify(doc, null, 4))
                    try { await plane.executor.run(`ALTER TABLE "${drop.entity}" DROP COLUMN "${drop.field}"`, []) } catch {}
                }
                try { await plane.executor.run(`DELETE FROM "_nexus_embeddings" WHERE entity = ?`, [name]) } catch {}
                await plane.executor.run(`DROP TABLE IF EXISTS "${name}"`, [])
                const { rmSync } = await import("fs")
                rmSync(join(root, plan.schemaFile))
                await reloadInstance()
                devBroadcast("reload") // structural change — the client does a full page reload
                return json(res, 200, { ok: true, data: { deleted: name, plan } })
            } catch (error) {
                const code = String(error.message).split(":")[0]
                return json(res, code.startsWith("E_") ? 400 : 500, { ok: false, error: { code, message: error.message } })
            }
        }
        // The policy WINDOW (read-only, design 2026-07-19 §2): the exact
        // layers the engine composes, straight from its runtime arrays — the
        // UI can never drift from the enforced truth. Writes go through
        // /api/v1/nexus_policy ONLY.
        if (url.pathname === "/_studio/policies" && req.method === "GET") {
            const { app, system, admin, rows } = policyLayers()
            const byFile = new Map()
            for (const p of app) {
                const key = p.source ?? "app"
                if (!byFile.has(key)) byFile.set(key, [])
                byFile.get(key).push(p)
            }
            const layers = [
                ...[...byFile.entries()].map(([source, policies]) => ({ source, readonly: true, policies })),
                { source: "system", readonly: true, policies: system },
                { source: "admin", readonly: true, policies: admin },
                { source: "rows", readonly: false, policies: rows }
            ]
            return json(res, 200, { ok: true, data: { layers, devMode: !authState.required, authRequired: authState.required } })
        }

        // Studio session (whoami) MOVED to GET /api/v1/_session (Task 2, issue
        // #10) — one login contract in both dev and production. This dev-only
        // address is gone; it falls through to the "no other /_studio surface
        // exists" 404 below like any other dead path.
        // Studio user management (DEV-ONLY) — add/remove/role identities in
        // nexus.config.json AND (add/role) the nexus_user directory row that
        // actually grants login past first boot (issue #9 final review, item
        // 2). Adding the first identity turns required auth ON immediately.
        if (url.pathname === "/_studio/users" && req.method === "GET") {
            const cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
            return json(res, 200, { ok: true, data: { identities: listUsers(cfg), authRequired: authState.required } })
        }
        if (url.pathname === "/_studio/users" && req.method === "POST") {
            const body = await readJson(req)
            if (body === Symbol.for("E_BODY_SIZE")) {
                json(res, 413, { ok: false, error: { code: "E_BODY_SIZE" } })
                req.destroy()
                return
            }
            if (!body || typeof body.action !== "string") return json(res, 400, { ok: false, error: { code: "E_REQUEST" } })
            try {
                const cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
                let next = listUsers(cfg)
                // The DIRECTORY (nexus_user rows) is the truth past first boot
                // (issue #9 I4): knownPub/rolesForPub consult config identities
                // ONLY while the directory is still empty. Writing
                // nexus.config.json alone therefore provisions an identity
                // that CANNOT log in on any instance past that point — yet the
                // old code returned applied: true regardless. "add"/"role" now
                // mirror the write into the plane too, through the same
                // internal ctx the server's own directory actor uses
                // (nexusUserCtx/NEXUS_CTX_POLICIES) — the config array stays
                // CLI-facing bookkeeping; the row is what actually grants login.
                const findRow = async (pub) => {
                    const rows = await plane.list("nexus_user", { filter: { astVersion: 1, root: { field: "pub", operator: "eq", value: pub } } }, nexusUserCtx)
                    return rows[0] ?? null
                }
                if (body.action === "add") {
                    next = addUser(next, { pub: body.pub, name: body.name, roles: body.roles ?? [] })
                    // guard against a row already existing outside config (e.g.
                    // created directly through /api/v1/nexus_user) — create only
                    // when the directory doesn't already know this pub
                    if (!(await findRow(body.pub)))
                        await plane.create("nexus_user", { pub: body.pub, name: body.name || body.pub, roles: JSON.stringify(body.roles ?? []) }, nexusUserCtx)
                } else if (body.action === "remove") next = removeUser(next, body.pub)
                else if (body.action === "role") {
                    next = setRoles(next, body.pub, body.roles ?? [])
                    const row = await findRow(body.pub)
                    if (row) await plane.update("nexus_user", row.id, { roles: JSON.stringify(body.roles ?? []) }, nexusUserCtx)
                } else return json(res, 400, { ok: false, error: { code: "E_ACTION" } })
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
            return json(res, 200, { ok: true, data: { ...modelStatus(cfg, root), models: MODELS, nlModels: NL_MODELS } })
        }
        if (url.pathname === "/_studio/ai" && req.method === "POST") {
            const body = await readJson(req)
            if (body === Symbol.for("E_BODY_SIZE")) {
                json(res, 413, { ok: false, error: { code: "E_BODY_SIZE" } })
                req.destroy()
                return
            }
            let cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
            // each slot is applied only when its key is present — independent slots
            if (body && "model" in body) cfg = withModel(cfg, body.model || null)
            if (body && "nlModel" in body) cfg = withNlModel(cfg, body.nlModel || null)
            writeFileSync(join(root, "nexus.config.json"), JSON.stringify(cfg, null, 4) + "\n")
            return json(res, 200, { ok: true, data: { model: currentModel(cfg), nlModel: currentNlModel(cfg), restart: true } })
        }

        // Studio settings (DEV-ONLY): read the (redacted) config and set/unset
        // any dot-path — the same safe editing as `nexus config`. Restart applies.
        if (url.pathname === "/_studio/config" && req.method === "GET") {
            const cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
            return json(res, 200, { ok: true, data: { config: redact(cfg) } })
        }
        if (url.pathname === "/_studio/config" && req.method === "POST") {
            const body = await readJson(req)
            if (body === Symbol.for("E_BODY_SIZE")) {
                json(res, 413, { ok: false, error: { code: "E_BODY_SIZE" } })
                req.destroy()
                return
            }
            if (!body || typeof body.key !== "string") return json(res, 400, { ok: false, error: { code: "E_REQUEST" } })
            const cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
            const next = body.remove ? unsetPath(cfg, body.key) : setPath(cfg, body.key, body.value)
            writeFileSync(join(root, "nexus.config.json"), JSON.stringify(next, null, 4) + "\n")
            return json(res, 200, { ok: true, data: { restart: true } })
        }

        // no other /_studio surface exists — dead paths (like the removed
        // /_studio/permissions) answer 404, never the SPA shell
        if (url.pathname.startsWith("/_studio/")) return json(res, 404, { ok: false, error: { code: "E_NOT_FOUND" } })

        if (api && (await api(req, res))) return

        // SPA routes (akao build-thinking: routes are data, shared with the
        // client): /, /vi/, /en/entity/task, /permissions … all serve the SAME
        // shell — but ONLY paths that precisely match a known route with a
        // known value. File-looking paths and dotfiles never reach the shell
        // (SEC-01..04 hold: /nexus.config.json, /.nexus/*, backups stay 404).
        if (routeMatches(url.pathname)) {
            res.writeHead(200, { "content-type": MIME[".html"], "cache-control": "no-cache" })
            const html = studioIndex(config, schemas, { embedder: embedderInfo, appName, i18n })
            // dev-only bootstrap (design 2026-07-20 §3): wires up the shipped HMR
            // client. `nexus start` never serves the Studio shell at all, so
            // production HTML cannot carry this by construction (START-* pins it).
            const DEV_BOOTSTRAP = `<script>globalThis._dev = { enabled: true, runtime: "/_nexus/src/core/HMR.js" }</script><script src="/_nexus/src/core/HMR/client.js"></script>`
            return res.end(html.replace("</head>", `${DEV_BOOTSTRAP}</head>`))
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
        if (url.pathname === "/_nexus/src/studio/studio.css") {
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
