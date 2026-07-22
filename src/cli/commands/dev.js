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
import { studioRouteMatches } from "../../studio/routes.js"
import { validate } from "../../core/Model.js"
import { loadDictionary, mergeDictionaries, coveredLocales } from "../../i18n/i18n.js"
import { verifyChallenge, issueToken, verifyToken } from "../../core/App/auth.js"
import { listUsers, addUser, removeUser, setRoles } from "../../core/App/users.js"
import { MODELS, NL_MODELS, status as modelStatus, withModel, withNlModel, currentModel, currentNlModel } from "../../core/App/models.js"
import { redact, setPath, unsetPath } from "../../core/App/config.js"
import { randomBytes } from "crypto"
import { fileURLToPath } from "url"
import { createWatcher, devMessage } from "../../core/HMR/watch.js"
import { accessFor } from "../dev-access.js"
import { limiterFor, tierFor, clientKey } from "../../core/HTTP/ratelimit.js"

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
    let { api, plane, authState, challenges, engine, authMode, embedderInfo, effects, close } = await buildInstanceApi({ root, config, schemas, apps, appPolicies, mode: "dev" })

    // ── hot reload — entity writes NEVER require a dev restart ──────────────
    // Reloading swaps the whole instance surface (schemas, plane, API) in
    // place; every request closure reads these let-bindings, so the very next
    // request runs on the new shape.
    //
    // BUILD FIRST, RELEASE SECOND. This used to stop the old effects before
    // loading, which had two costs. The old instance's database handle was
    // never closed at all — the comment here claimed it was "left to the GC",
    // but nothing outside buildInstanceApi ever held it, so it was retained
    // and unreachable, and five reloads took this process from 3 to 17
    // descriptors on the same file. And a rebuild that THREW — a malformed
    // model file dropped into apps/ is enough — left dev serving from the old
    // plane with its job runner already stopped, saying nothing.
    //
    // In this order a failed rebuild touches nothing: the old bundle is still
    // bound, still running its effects, still holding its handle. Two sqlite
    // connections exist for the length of the rebuild, which is what WAL is
    // for (DEVFD-01/02).
    async function reloadInstance() {
        const fresh = loadInstance(root)
        const previous = { effects, close }

        // `appPolicies` is refilled IN PLACE, never replaced: the array's
        // identity is the contract — buildInstanceApi's policyLayers() closes
        // over it so a hot policy write is visible on the very next call. A
        // fresh array here would quietly sever that.
        appPolicies.length = 0
        appPolicies.push(...fresh.policies)
        const built = await buildInstanceApi({ root, config: fresh.config, schemas: fresh.schemas, apps: fresh.apps, appPolicies, mode: "dev" })

        // Past this line the rebuild has SUCCEEDED, so the swap cannot leave a
        // half-replaced instance behind, and only now is the old one released.
        config = fresh.config
        schemas = fresh.schemas
        apps = fresh.apps
        schemaFiles = fresh.files
        ;({ api, plane, authState, challenges, engine, authMode, embedderInfo, effects, close } = built)

        await previous.effects.stop()
        await previous.close()
    }

    // ── dev tooling stream (design 2026-07-20 §3): the server half of the
    // shipped akao HMR client. Dev-only; `nexus start` never mounts this.
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
        onChange: async (change) => {
            // NEXUS_ROOT (from fileURLToPath of a directory URL) carries a
            // trailing separator; devMessage's dir comparison is exact, so
            // strip it here rather than fuzz the pure helper's match rule.
            const nexusRoot = NEXUS_ROOT.replace(/[\\/]+$/, "")
            const appsDir = join(root, "apps")
            const msg = devMessage(change, { nexusRoot, appsDir })
            if (!msg) return
            // An app file that changed on DISK — a model added by hand, a
            // hooks.js edited in an editor — needs the instance re-read before
            // the browser is told to reload. Broadcasting alone sent the page
            // back for the SAME schema list the server still held, so a model
            // file dropped into apps/ stayed invisible until dev was restarted.
            // The Studio's own /_studio/model path always called this; the
            // watcher path never did, so the two disagreed about what "hot
            // reload" meant depending on who wrote the file (E2E-04).
            if (change.dir === appsDir) {
                try {
                    await reloadInstance()
                } catch (error) {
                    console.warn(`hot reload: could not re-read the instance — ${String(error?.message ?? error)}`)
                }
            }
            devBroadcast(msg)
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

    // The Studio's route table — the SAME declared list `nexus start` reuses
    // for the built Studio (studio/routes.js), so the two servers can never
    // answer "is this a Studio page" differently.
    function routeMatches(pathname) {
        return studioRouteMatches(pathname, { schemas, locales: i18n.locales })
    }

    // Dev is limited too: it is routinely reachable on a LAN and holds real
    // data. Same tiers, same config key, same off switch as production.
    const limiter = limiterFor(config)
    const trustProxy = config.limits?.trust_proxy === true

    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://localhost")

        // Observability: one line per request on stderr (stdout stays clean for
        // --json). Timed at response finish so the status and latency are real.
        const started = Date.now()
        res.on("finish", () => process.stderr.write(`  ${req.method} ${url.pathname} ${out.dim("→")} ${res.statusCode} ${out.dim(`${Date.now() - started}ms`)}\n`))

        // Rate limiting (RATE-*). Before any work, and after the log line so a
        // refusal is still visible. Dev shares production's tiers and its
        // exemptions: /_health so a probe is never starved, and the dev event
        // stream so HMR cannot throttle itself during a burst of file saves.
        if (limiter && url.pathname !== "/_health" && url.pathname !== "/__dev_events") {
            const verdict = limiter.check(clientKey(req, { trustProxy }), tierFor(url.pathname))
            if (!verdict.allowed) {
                res.setHeader?.("retry-after", String(verdict.retryAfter))
                return json(res, 429, { ok: false, error: { code: "E_RATE_LIMIT", message: `too many requests — retry in ${verdict.retryAfter}s` } })
            }
        }

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
        // exemption belongs ONLY in dev-access.js's declared table.
        //
        // `authState.required` is read LIVE, not snapshotted at boot. It used to
        // be a boot-time constant, on the reasoning that a session which booted
        // open should stay usable while you configure auth from it. The cost of
        // that was a real window: between adding the first admin — which flips
        // the DATA API closed immediately — and the next dev restart,
        // /_studio/config stayed wide open, and it writes arbitrary dot-paths
        // into nexus.config.json INCLUDING token_secret. On a dev server
        // reachable from a LAN, that is forge-tokens-forever.
        //
        // The window it protected is about a second wide: the users page
        // reloads itself into the login gate after provisioning, and signing in
        // with the same passphrase hands you the admin token the gate now wants.
        // The genuine lockout — mistyping the passphrase you just chose — is
        // recoverable on a LOCAL instance whose config file and database are
        // sitting right there, which a writable token_secret on the network is
        // not (STUDIO-14).
        if (url.pathname.startsWith("/_studio/") && authState.required && accessFor(url.pathname) !== "any") {
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
                const { entityDeletePlan, applyEntityDelete } = await import("../../core/App/lifecycle.js")
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
                // Execute the plan — nothing beyond what it named. The cascade
                // itself lives in core (applyEntityDelete): it is one
                // transaction, it swallows nothing, and it is clause-covered
                // (LIFE-TX-*), none of which was true while it lived here as a
                // route body no test could import. This endpoint's job is
                // gathering inputs and reporting — which is all its comment
                // above ever claimed it did.
                await applyEntityDelete({ executor: plane.executor, root, plan, dialect: plane.dialect })
                // The policy/view rows went through raw DML inside that
                // transaction rather than plane.remove(), because a nested
                // transaction is not a thing (E_NESTED_TX) — so the caches
                // those after-hooks would have refreshed are rebuilt by the
                // reload below, which a structural change triggers anyway.
                await reloadInstance()
                devBroadcast("reload") // structural change — the client does a full page reload
                return json(res, 200, { ok: true, data: { deleted: name, plan } })
            } catch (error) {
                const code = String(error.message).split(":")[0]
                return json(res, code.startsWith("E_") ? 400 : 500, { ok: false, error: { code, message: error.message } })
            }
        }
        // The policy WINDOW (read-only, design 2026-07-19 §2) MOVED to GET
        // /api/v1/_policy-layers (Task 3, issue #10) — an ordinary,
        // admin-authorized API route sharing ONE implementation with
        // production (src/core/HTTP/server.js), instead of a bespoke
        // /_studio gate check. This dev-only address is gone; it falls
        // through to the "no other /_studio surface exists" 404 below like
        // any other dead path.

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
            const html = studioIndex(config, schemas, { embedder: embedderInfo, appName, i18n, mode: "dev" })
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
    // ── teardown ───────────────────────────────────────────────────────────
    // This used to say a signal handler was unnecessary because "the spawned
    // dev process is SIGKILLed by callers/tests, which reaps it along with
    // everything else". That describes the test harness, not the developer
    // pressing Ctrl+C — who got a process that died by SIGTERM with no exit
    // code and its write-ahead log still on disk, uncheckpointed. Closing the
    // last sqlite connection is what checkpoints it; abandoning the process
    // never does (DEVDOWN-01/02).
    //
    // Ordered outside-in: stop accepting work, release what holds clients
    // open, then close what holds the disk open. `stopping` makes it
    // idempotent — an impatient second Ctrl+C during shutdown must not start a
    // second teardown (DEVDOWN-03).
    let stopping = false
    const shutdown = async () => {
        if (stopping) return
        stopping = true
        try { watcher.stop() } catch { /* already stopped */ }
        try { await effects.stop() } catch { /* nothing to stop */ }
        // A dev EventSource left hanging makes the browser reconnect to a port
        // that is going away; ending it tells the client this was deliberate.
        for (const res of [...devSubscribers]) try { res.end() } catch { /* already gone */ }
        devSubscribers.clear()
        try { await close() } catch { /* already closed */ }
        server.close(() => process.exit(0))
        // A client holding a keep-alive socket would otherwise keep the
        // process alive past the point where it can serve anything.
        setTimeout(() => process.exit(0), 2000).unref()
    }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    out.emit({ ok: true, url, port: actual, entities: schemas.map((s) => s.name) })
    return server
}
