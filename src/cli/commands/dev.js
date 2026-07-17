/**
 * nexus dev — serve the current instance over HTTP: the auto-generated
 * Data Plane API under /api/v1 plus static files and a generated index.
 * Zero dependencies: Node's http + node:sqlite (the akao dev.js lineage —
 * no NGINX, no Redis, no Supervisor).
 *
 * DEV IDENTITY — deliberate and loud: this server grants a wide-open DEV
 * policy (every action, every permlevel) to a single dev user (overridable
 * per request via the x-nexus-user header). Real AuthN (ZEN keypair →
 * tokens) is specced before Phase 4 (ARCHITECTURE risk #11); a dev server
 * never pretends to be production auth.
 */

import { createServer } from "http"
import { existsSync, readFileSync, statSync } from "fs"
import { join, resolve, extname, sep } from "path"
import { loadInstance } from "../instance.js"
import { buildInstanceApi } from "../../http/instance-server.js"
import { verifyChallenge, issueToken } from "../../app/auth.js"
import { randomBytes } from "crypto"

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
const NEXUS_ROOT = new URL("../../..", import.meta.url).pathname

function indexPage(config, schemas) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${config.site?.name ?? "Nexus"} — Studio</title>
<style>
body{font-family:system-ui;max-width:960px;margin:2rem auto;padding:0 1rem;line-height:1.5}
code{background:#8882;padding:.1em .4em;border-radius:4px}
select,button,textarea,input{font:inherit;padding:4px 8px;border:1px solid #94a3b8;border-radius:6px;background:transparent;color:inherit}
button{cursor:pointer}
.muted{color:#64748b}
.topbar{display:flex;gap:.8rem;align-items:center;flex-wrap:wrap;margin:.6rem 0}
nav.tabs{display:flex;gap:.3rem;border-bottom:1px solid #94a3b833;margin:1rem 0}
nav.tabs button{border:none;border-bottom:2px solid transparent;border-radius:0;background:transparent;padding:6px 12px;color:#64748b}
nav.tabs button[aria-selected="true"]{color:inherit;border-bottom-color:#0ea5e9;font-weight:600}
section.panel{padding:.4rem 0}
section.panel[hidden]{display:none}
.row{display:flex;gap:.5rem;margin:.6rem 0;align-items:flex-start}
.row textarea{flex:1;height:3.2em;font-family:ui-monospace,monospace;font-size:13px}
pre.out{background:#8881;padding:.6rem;border-radius:6px;overflow:auto;font-size:12px;max-height:340px}
.err{color:#dc2626;white-space:pre-wrap}
.ok{color:#16a34a}
h2{font-size:1rem;margin:.2rem 0 .6rem}
</style>
</head><body>
<h1>⬡ ${config.site?.name ?? "Nexus"} <span class="muted" style="font-size:.6em;font-weight:400">Studio</span></h1>
<p class="muted">Entities: ${schemas.map((s) => `<code>${s.name}</code>`).join(" · ") || "—"}
 — API: <code>GET/POST /api/v1/:entity</code> · <code>GET/PATCH/DELETE /api/v1/:entity/:id</code> · <code>POST /api/v1/:entity/query</code></p>
<div class="topbar">
    <label>Entity <select id="entity">${schemas.map((s) => `<option>${s.name}</option>`).join("")}</select></label>
    <span class="muted" id="count"></span>
</div>
<nav class="tabs">
    <button id="tab-data" aria-selected="true">Data</button>
    <button id="tab-form">Form</button>
    <button id="tab-search">Search</button>
    <button id="tab-schema">Schema</button>
    <button id="tab-perms">Permissions</button>
</nav>

<section class="panel" id="panel-data">
    <div class="row">
        <input id="ask" placeholder='Ask in plain language — e.g. done = true and points > 3' style="flex:1" spellcheck="false">
        <button id="ask-go">Ask → AST</button>
    </div>
    <div id="data-builder"></div>
    <div class="row">
        <textarea id="data-payload" placeholder='{"title": "hello nexus"}' spellcheck="false"></textarea>
        <button id="data-create">POST row</button>
    </div>
    <div class="err" id="data-error"></div>
    <div id="data-results"></div>
</section>

<section class="panel" id="panel-form" hidden>
    <h2>Runtime form for <code id="form-entity"></code> — submits to <code>POST /api/v1/:entity</code></h2>
    <div id="form-slot"></div>
    <div id="form-msg" class="ok"></div>
</section>

<section class="panel" id="panel-search" hidden>
    <h2>Global search — <code>POST /api/v1/:entity/search</code> (needs an embedder for vector; text always works)</h2>
    <div id="search-slot"></div>
</section>

<section class="panel" id="panel-schema" hidden>
    <h2>Schema designer — live additive-vs-structural diff</h2>
    <div id="schema-slot"></div>
    <p class="muted">Resulting Model Schema v1 (frozen format):</p>
    <pre class="out" id="schema-out"></pre>
</section>

<section class="panel" id="panel-perms" hidden>
    <h2>Permission manager — row rules reuse the query builder</h2>
    <div id="perms-slot"></div>
    <p class="muted">Resulting Permission v1 policies:</p>
    <pre class="out" id="perms-out"></pre>
</section>

<script type="application/json" id="schemas">${JSON.stringify(schemas)}</script>
<script type="module">
import "/_nexus/src/studio/query-builder.js"
import "/_nexus/src/studio/form-builder.js"
import "/_nexus/src/studio/permission-manager.js"
import "/_nexus/src/studio/schema-designer.js"
import "/_nexus/src/studio/list-view.js"
import "/_nexus/src/studio/search.js"

const schemas = JSON.parse(document.getElementById("schemas").textContent)
const $ = (id) => document.getElementById(id)
const state = { entity: schemas[0] ? schemas[0].name : null, tab: "data" }
const currentSchema = () => schemas.find((s) => s.name === state.entity)

async function postJSON(path, body) {
    const response = await fetch("/api/v1/" + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    return response.json()
}

// ── Data: query builder → /query → list view (dogfooded) ──────────────────────
let qbuilder = null, listView = null, qtimer = null
function mountData() {
    const slot = $("data-builder"); slot.replaceChildren()
    qbuilder = document.createElement("nx-query-builder")
    qbuilder.schema = currentSchema()
    qbuilder.addEventListener("change", (e) => { if (!e.detail.valid) return; clearTimeout(qtimer); qtimer = setTimeout(runQuery, 250) })
    slot.appendChild(qbuilder)
    const rslot = $("data-results"); rslot.replaceChildren()
    listView = document.createElement("nx-list-view")
    rslot.appendChild(listView)
    runQuery()
}
async function runQuery() {
    $("data-error").textContent = ""
    const body = await postJSON(state.entity + "/query", { filter: qbuilder.value, limit: 50 })
    if (!body.ok) { $("data-error").textContent = body.error.code + ": " + body.error.message; return }
    $("count").textContent = body.data.length + (body.data.length === 1 ? " row" : " rows")
    listView.schema = currentSchema()
    listView.rows = body.data
}
$("data-create").addEventListener("click", async () => {
    $("data-error").textContent = ""
    let payload
    try { payload = JSON.parse($("data-payload").value || "{}") } catch { $("data-error").textContent = "E_JSON: payload is not valid JSON"; return }
    const body = await postJSON(state.entity, payload)
    if (!body.ok) { $("data-error").textContent = body.error.code + ": " + body.error.message; return }
    $("data-payload").value = ""; runQuery()
})

// NL → AST: the /ask endpoint translates plain language into a validated Query
// AST and runs it through the same permission-checked pipeline.
async function runAsk() {
    const query = $("ask").value.trim()
    if (!query) return
    $("data-error").textContent = ""
    const body = await postJSON(state.entity + "/ask", { query, limit: 50 })
    if (!body.ok) { $("data-error").textContent = body.error.code + ": " + body.error.message; return }
    // /ask returns { filter, rows }: show the rows AND reflect the derived AST
    // back into the visual builder, so plain language and the builder stay one.
    const rows = Array.isArray(body.data) ? body.data : (body.data.rows ?? [])
    if (body.data && body.data.filter && qbuilder) qbuilder.value = body.data.filter
    $("count").textContent = rows.length + (rows.length === 1 ? " row" : " rows") + " · asked: “" + query + "”"
    if (listView) { listView.schema = currentSchema(); listView.rows = rows }
}
$("ask-go").addEventListener("click", runAsk)
$("ask").addEventListener("keydown", (e) => { if (e.key === "Enter") runAsk() })

// ── Form: nx-form runtime → submit → create ───────────────────────────────────
function mountForm() {
    $("form-entity").textContent = state.entity
    const slot = $("form-slot"); slot.replaceChildren()
    const form = document.createElement("nx-form")
    form.schema = currentSchema()
    form.addEventListener("submit", async (e) => {
        const body = await postJSON(state.entity, e.detail.value)
        const msg = $("form-msg")
        msg.className = body.ok ? "ok" : "err"
        msg.textContent = body.ok ? "Created " + body.data.id : body.error.code + ": " + body.error.message
    })
    slot.appendChild(form)
    $("form-msg").textContent = ""
}

// ── Search: nx-search with a searcher wired to /search ────────────────────────
function mountSearch() {
    const slot = $("search-slot"); slot.replaceChildren()
    const search = document.createElement("nx-search")
    search.schemas = schemas
    search.searcher = async ({ entity, query }) => {
        const body = await postJSON(entity + "/search", { query, mode: "hybrid" })
        return body.ok ? body.data : []
    }
    slot.appendChild(search)
}

// ── Schema designer: live diff, emits Model Schema v1 ─────────────────────────
function mountSchema() {
    const slot = $("schema-slot"); slot.replaceChildren()
    const designer = document.createElement("nx-schema-designer")
    designer.baseline = currentSchema()
    designer.addEventListener("change", () => { $("schema-out").textContent = JSON.stringify(designer.value, null, 2) })
    slot.appendChild(designer)
    $("schema-out").textContent = JSON.stringify(currentSchema(), null, 2)
}

// ── Permission manager: emits Permission v1 policies ──────────────────────────
function mountPerms() {
    const slot = $("perms-slot"); slot.replaceChildren()
    const perms = document.createElement("nx-permission-manager")
    perms.schemas = schemas
    perms.addEventListener("change", () => { $("perms-out").textContent = JSON.stringify(perms.value, null, 2) })
    slot.appendChild(perms)
    $("perms-out").textContent = "[]"
}

// ── tabs ──────────────────────────────────────────────────────────────────────
const tabs = { data: mountData, form: mountForm, search: mountSearch, schema: mountSchema, perms: mountPerms }
function show(tab) {
    state.tab = tab
    for (const name of Object.keys(tabs)) {
        $("panel-" + name).hidden = name !== tab
        $("tab-" + name).setAttribute("aria-selected", String(name === tab))
    }
    tabs[tab]()
}
for (const name of Object.keys(tabs)) $("tab-" + name).addEventListener("click", () => show(name))
$("entity").addEventListener("change", () => { state.entity = $("entity").value; tabs[state.tab](); })
show("data")
</script>
</body></html>`
}

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
    // Data Plane + auth + API through the shared wiring. Dev mode falls back to
    // the loud DEV identity when no auth is configured (production refuses that).
    const { api, authState, challenges, engine, authMode } = await buildInstanceApi({ root, config, schemas, apps, appPolicies, mode: "dev" })

    const json = (res, code, obj) => {
        res.writeHead(code, { "content-type": "application/json; charset=utf-8" })
        res.end(JSON.stringify(obj))
    }
    const readJson = (req) =>
        new Promise((resolve) => {
            let raw = ""
            req.on("data", (c) => {
                raw += c
                if (raw.length > 65536) req.destroy()
            })
            req.on("end", () => {
                try {
                    resolve(JSON.parse(raw || "{}"))
                } catch {
                    resolve(null)
                }
            })
        })

    const server = createServer(async (req, res) => {
        const url = new URL(req.url, "http://localhost")

        // Observability: one line per request on stderr (stdout stays clean for
        // --json). Timed at response finish so the status and latency are real.
        const started = Date.now()
        res.on("finish", () => process.stderr.write(`  ${req.method} ${url.pathname} ${out.dim("→")} ${res.statusCode} ${out.dim(`${Date.now() - started}ms`)}\n`))

        // Liveness/readiness — always available, no auth, cheap. Standard shape
        // for load balancers, container probes, and `nexus doctor`.
        if (url.pathname === "/_health") {
            return json(res, 200, { ok: true, data: { status: "ok", entities: schemas.map((s) => s.name), engine, uptime: Math.round(process.uptime()) } })
        }

        // ZEN auth handshake — issue a nonce, verify a signature, mint a token.
        // Only live once a token secret exists (i.e. the instance has data).
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

        if (api && (await api(req, res))) return

        if (url.pathname === "/") {
            res.writeHead(200, { "content-type": MIME[".html"] })
            return res.end(indexPage(config, schemas))
        }
        // Framework modules for instance pages — /_nexus/{src,vendor}/* only,
        // resolved inside the Nexus package, traversal-guarded. vendor/ is
        // needed because Studio components (e.g. the schema designer) import
        // the data layer, which imports the vendored Kysely.
        if (url.pathname.startsWith("/_nexus/")) {
            const path = resolve(NEXUS_ROOT, "." + url.pathname.slice("/_nexus".length))
            const allowed = path.startsWith(join(NEXUS_ROOT, "src")) || path.startsWith(join(NEXUS_ROOT, "vendor"))
            if (!allowed || !existsSync(path) || !statSync(path).isFile()) {
                res.writeHead(404, { "content-type": "text/plain" })
                return res.end("Not found")
            }
            res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" })
            return res.end(readFileSync(path))
        }
        // Static files — SECURITY (SEC-01..04): served ONLY from <root>/public/,
        // never from the instance root. The root holds nexus.config.json (API
        // keys), .nexus/data.db (the whole database) and backups — none of
        // which may ever leave over HTTP. The public/ dir is the one place an
        // instance opts into exposing assets; the startsWith guard keeps a
        // traversal inside it.
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
        out.print(`  ${out.dim("api")}   ${url}/api/v1/${schemas[0].name} ${out.dim(`(+ ${schemas.length - 1} more)`)}`)
        out.print(`  ${out.dim("auth")}  ${out.yellow(authMode)}`)
        out.print(`  ${out.dim("data")}  engine ${engine}${engine === "sqlite" ? " · .nexus/data.db" : ""}`)
    }
    out.emit({ ok: true, url, port: actual, entities: schemas.map((s) => s.name) })
    return server
}
