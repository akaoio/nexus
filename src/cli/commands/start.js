/**
 * nexus start — production server (ARCHITECTURE.md §5.2, line "nexus start ·
 * production, HTTPS tự cấp"). The akao dev.js/prod.js lineage: one self-
 * contained process, self-served HTTPS, no NGINX/Supervisor/Redis.
 *
 * Two hard differences from `nexus dev`, both security-driven:
 *   1. NO god-mode. Production goes through the shared wiring in mode
 *      "production", which throws E_NO_AUTH if the instance has no api_keys or
 *      identities — it will never serve the wide-open DEV identity to a network.
 *   2. NO Studio and NO framework-source route. Production serves only the API,
 *      the auth handshake, /_health, and the instance's own public/ assets —
 *      never /_nexus/src or an admin UI.
 *
 * TLS: a key+cert from SSL_KEY/SSL_CERT (or <root>/.certs/{key,cert}.pem) →
 * HTTPS. Missing certs is a loud E_NO_TLS unless --insecure is passed (for
 * localhost or a TLS-terminating proxy).
 */

import { createServer as createHttp } from "http"
import { createServer as createHttps } from "https"
import { existsSync, readFileSync, statSync } from "fs"
import { join, resolve, extname, sep } from "path"
import { loadInstance } from "../instance.js"
import { buildInstanceApi } from "../../core/HTTP/server.js"
import { verifyChallenge, issueToken } from "../../core/App/auth.js"
import { randomBytes } from "crypto"

const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".mjs": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".ico": "image/x-icon"
}

export async function start(args, flags, out) {
    const root = process.cwd()
    if (!existsSync(join(root, "nexus.config.json"))) {
        out.error("Not a Nexus instance (no nexus.config.json here)", { code: "E_NO_INSTANCE" })
        process.exitCode = 1
        return
    }

    const port = flags.port !== undefined ? Number(flags.port) : 443
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        out.error(`Invalid port: ${flags.port}`, { code: "E_USAGE" })
        process.exitCode = 2
        return
    }

    const { config, schemas, apps, policies: appPolicies } = loadInstance(root)

    // Shared wiring in production mode — refuses the DEV identity loudly.
    let api, authState, challenges, engine, authMode, effects
    try {
        ;({ api, authState, challenges, engine, authMode, effects } = await buildInstanceApi({ root, config, schemas, apps, appPolicies, mode: "production" }))
    } catch (error) {
        if (error.code === "E_NO_AUTH") {
            out.error(error.message, { code: "E_NO_AUTH" })
            process.exitCode = 1
            return
        }
        if (error.code === "E_NO_SECRET") {
            out.error(error.message, { code: "E_NO_SECRET" })
            process.exitCode = 1
            return
        }
        throw error
    }

    // TLS resolution.
    const keyPath = process.env.SSL_KEY || process.env.HTTPS_KEY || join(root, ".certs", "key.pem")
    const certPath = process.env.SSL_CERT || process.env.HTTPS_CERT || join(root, ".certs", "cert.pem")
    const haveCerts = existsSync(keyPath) && existsSync(certPath)
    const insecure = flags.insecure === true || flags.insecure === "true"
    if (!haveCerts && !insecure) {
        // the effect runner is already live at this point (buildInstanceApi
        // spawned the job thread + poll interval) — stop it before returning,
        // or the process never exits on its own (no server ever listens)
        await effects.stop()
        out.error(
            `No TLS certificate found (looked for ${keyPath} and ${certPath}). Set SSL_KEY/SSL_CERT, place key.pem + cert.pem under .certs/, or pass --insecure to serve plain HTTP (localhost or behind a TLS-terminating proxy only).`,
            { code: "E_NO_TLS" }
        )
        process.exitCode = 1
        return
    }

    const json = (res, code, obj) => {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" })
        res.end(JSON.stringify(obj))
    }
    // BODY_LIMIT (issue #9 I2): this reader feeds the PRE-AUTH /_auth/verify
    // route, so it must cap itself the same as api.js's authenticated body
    // reader (api.js:23) — nothing here waits for a credential first.
    const BODY_LIMIT = 1024 * 1024 // 1MB
    // CHALLENGE_CAP (issue #9 I3): the challenge Map grows on every
    // unauthenticated /_auth/challenge call; entries are removed only on a
    // SUCCESSFUL verify. Swept on insert + capped so a flood cannot OOM it.
    const CHALLENGE_CAP = 1000
    const readJson = (req) =>
        new Promise((done) => {
            let raw = ""
            let size = 0
            req.on("data", (c) => {
                size += c.length
                // sentinel, not a hang — and NOT req.destroy() here: destroying
                // the request kills the underlying socket immediately, which
                // takes the response down with it before the call site ever
                // gets to write the 413 (destroy happens AFTER the response,
                // at the call site, once it is safe to close the connection)
                if (size > BODY_LIMIT) done(Symbol.for("E_BODY_SIZE"))
                else raw += c
            })
            req.on("end", () => {
                try {
                    done(raw ? JSON.parse(raw) : {})
                } catch {
                    done(null)
                }
            })
            req.on("error", () => done(null))
        })

    const handler = async (req, res) => {
        const url = new URL(req.url, "http://localhost")
        const started = Date.now()
        res.on("finish", () => process.stderr.write(`  ${req.method} ${url.pathname} ${out.dim("→")} ${res.statusCode} ${out.dim(`${Date.now() - started}ms`)}\n`))

        if (url.pathname === "/_health") {
            return json(res, 200, { ok: true, data: { status: "ok", entities: schemas.map((s) => s.name), engine, uptime: Math.round(process.uptime()) } })
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
            challenges.delete(b.nonce)
            if (!(await verifyChallenge(b.pub, b.nonce, b.signature)))
                return json(res, 401, { ok: false, error: { code: "E_AUTH", message: "signature does not prove the key" } })
            if (!authState.knownPub(b.pub))
                return json(res, 401, { ok: false, error: { code: "E_AUTH", message: "this identity is not provisioned on this instance" } })
            const roles = authState.rolesForPub(b.pub)
            const token = issueToken({ user: b.pub, roles }, authState.secret)
            return json(res, 200, { ok: true, data: { token, roles } })
        }

        if (api && (await api(req, res))) return

        // Static — ONLY the instance's public/ dir (never the instance root nor
        // framework source). Same SEC-01..04 boundary as dev.
        const publicDir = join(root, "public")
        const path = resolve(publicDir, "." + url.pathname)
        if (path === publicDir || !path.startsWith(publicDir + sep) || !existsSync(path) || !statSync(path).isFile()) {
            res.writeHead(404, { "content-type": "text/plain" })
            return res.end("Not found")
        }
        res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" })
        res.end(readFileSync(path))
    }

    const server = haveCerts
        ? createHttps({ key: readFileSync(keyPath), cert: readFileSync(certPath) }, handler)
        : createHttp(handler)

    await new Promise((ready, failed) => {
        server.once("error", failed)
        server.listen(port, ready)
    })
    const actual = server.address().port
    const scheme = haveCerts ? "https" : "http"
    const url = `${scheme}://localhost:${actual}`
    out.print(`${out.green("⬡")} Nexus ${out.cyan("start")} · ${out.cyan(url)}  ${out.dim(haveCerts ? "(TLS · Ctrl+C to stop)" : "(Ctrl+C to stop)")}`)
    out.print(`  ${out.dim("auth")}  ${authMode}`)
    out.print(`  ${out.dim("data")}  engine ${engine}`)
    if (!haveCerts) out.print(`  ${out.yellow("insecure")} serving plain HTTP — terminate TLS upstream or restart with certificates`)

    const shutdown = () => { effects.stop().finally(() => server.close(() => process.exit(0))) }
    process.on("SIGINT", shutdown)
    process.on("SIGTERM", shutdown)

    out.emit({ ok: true, url, port: actual, tls: haveCerts, engine, entities: schemas.map((s) => s.name) })
    return server
}

export default start
