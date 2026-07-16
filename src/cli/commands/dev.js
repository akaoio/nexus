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
import { DataPlane } from "../../data/DataPlane.js"
import { createApi } from "../../http/api.js"
import { openInstanceData, ensureTables } from "../data.js"
import { loadExtensions } from "../../app/Extensions.js"
import { policiesFor } from "../../app/Policies.js"
import { timingSafeStringEqual } from "../output.js"
import { ACTIONS } from "../../permission/Permission.js"

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

/** Wide-open DEV policies: every action at every permlevel, per entity. */
function devPolicies(schemas) {
    const policies = []
    for (const schema of schemas)
        for (let permlevel = 0; permlevel <= 9; permlevel++)
            policies.push({ entity: schema.name, actions: [...ACTIONS], rule: null, permlevel, ifOwner: false })
    return policies
}

function indexPage(config, schemas) {
    return `<!doctype html><html><head><meta charset="utf-8"><title>${config.site?.name ?? "Nexus"}</title>
<style>
body{font-family:system-ui;max-width:860px;margin:3rem auto;padding:0 1rem;line-height:1.5}
code{background:#8882;padding:.1em .4em;border-radius:4px}
select,button,textarea{font:inherit;padding:4px 8px;border:1px solid #94a3b8;border-radius:6px;background:transparent;color:inherit}
button{cursor:pointer}
table{border-collapse:collapse;width:100%;margin-top:.8rem;font-size:14px}
th,td{border:1px solid #94a3b833;padding:4px 8px;text-align:left;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
th{background:#8881}
.muted{color:#64748b}
.toolbar{display:flex;gap:.6rem;align-items:center;margin:.8rem 0}
#creator{display:flex;gap:.5rem;margin:.6rem 0}
#creator textarea{flex:1;height:3.2em;font-family:ui-monospace,monospace;font-size:13px}
#error{color:#dc2626;white-space:pre-wrap}
</style>
</head><body>
<h1>⬡ ${config.site?.name ?? "Nexus"}</h1>
<p class="muted">Entities: ${schemas.map((s) => `<code>${s.name}</code>`).join(" · ") || "—"}
 — API: <code>GET/POST /api/v1/:entity</code> · <code>GET/PATCH/DELETE /api/v1/:entity/:id</code> · <code>POST /api/v1/:entity/query</code></p>

<div class="toolbar">
    <label>Entity <select id="entity">${schemas.map((s) => `<option>${s.name}</option>`).join("")}</select></label>
    <span class="muted" id="count"></span>
</div>
<div id="builder-slot"></div>
<div id="creator">
    <textarea id="payload" placeholder='{"title": "hello nexus"}' spellcheck="false"></textarea>
    <button id="create">POST row</button>
</div>
<div id="error"></div>
<div id="results"></div>

<script type="application/json" id="schemas">${JSON.stringify(schemas)}</script>
<script type="module">
import "/_nexus/src/studio/query-builder.js"

const schemas = JSON.parse(document.getElementById("schemas").textContent)
const $entity = document.getElementById("entity")
const $slot = document.getElementById("builder-slot")
const $results = document.getElementById("results")
const $count = document.getElementById("count")
const $error = document.getElementById("error")

let builder = null
let timer = null

function currentSchema() {
    return schemas.find((s) => s.name === $entity.value)
}

function mountBuilder() {
    $slot.replaceChildren()
    builder = document.createElement("nx-query-builder")
    builder.schema = currentSchema()
    builder.addEventListener("change", (e) => {
        if (!e.detail.valid) return
        clearTimeout(timer)
        timer = setTimeout(run, 250)
    })
    $slot.appendChild(builder)
    run()
}

async function run() {
    $error.textContent = ""
    const response = await fetch(\`/api/v1/\${$entity.value}/query\`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filter: builder.value, limit: 50 })
    })
    const body = await response.json()
    if (!body.ok) {
        $error.textContent = \`\${body.error.code}: \${body.error.message}\`
        return
    }
    renderRows(body.data)
}

function renderRows(rows) {
    $count.textContent = \`\${rows.length} row\${rows.length === 1 ? "" : "s"}\`
    if (!rows.length) {
        $results.innerHTML = '<p class="muted">No rows match. POST one above.</p>'
        return
    }
    const schema = currentSchema()
    const columns = ["id", ...schema.fields.filter((f) => f.type !== "table").map((f) => f.name), "owner"]
    const table = document.createElement("table")
    table.innerHTML = "<thead><tr>" + columns.map((c) => \`<th>\${c}</th>\`).join("") + "</tr></thead>"
    const tbody = document.createElement("tbody")
    for (const row of rows) {
        const tr = document.createElement("tr")
        for (const column of columns) {
            const td = document.createElement("td")
            const value = row[column]
            td.textContent = value === null || value === undefined ? "" : String(value)
            tr.appendChild(td)
        }
        tbody.appendChild(tr)
    }
    table.appendChild(tbody)
    $results.replaceChildren(table)
}

document.getElementById("create").addEventListener("click", async () => {
    $error.textContent = ""
    let payload
    try {
        payload = JSON.parse(document.getElementById("payload").value || "{}")
    } catch {
        $error.textContent = "E_JSON: payload is not valid JSON"
        return
    }
    const response = await fetch(\`/api/v1/\${$entity.value}\`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload)
    })
    const body = await response.json()
    if (!body.ok) {
        $error.textContent = \`\${body.error.code}: \${body.error.message}\`
        return
    }
    run()
})

$entity.addEventListener("change", mountBuilder)
mountBuilder()
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
    const extensions = await loadExtensions(root, apps)

    // Data Plane over the configured engine (nexus.config.json → database),
    // default: the built-in sqlite engine persisting to .nexus/data.db
    let api = null
    let engine = "sqlite"
    let authMode = "no entities"
    if (schemas.length) {
        const data = await openInstanceData(root, config)
        engine = data.engine
        const { executor, kysely } = data
        await ensureTables(executor, kysely, schemas, executor.dialect)
        // Semantic (§4.6): the deterministic hash provider is the dev/offline
        // default when any entity declares a semantic block — real providers
        // (transformers.js locally, API) plug in with the same interface
        const { hashProvider } = await import("../../semantic/semantic.js")
        const embedder = schemas.some((s) => s.semantic) ? hashProvider() : null
        const plane = new DataPlane({ executor, schemas, dialect: executor.dialect, hooks: extensions, embedder })
        // Auth (docs/authn-design.md): api_keys configured → key auth REQUIRED
        // with app-policy role assignment; otherwise the loud DEV identity.
        const keys = Array.isArray(config.api_keys) ? config.api_keys : []
        let context
        if (keys.length) {
            context = (req) => {
                const header = req.headers["authorization"] ?? ""
                const presented = header.startsWith("Bearer ") ? header.slice(7) : req.headers["x-nexus-key"]
                // Constant-time compare (SEC-06) — every key is checked so the
                // timing does not depend on which one (if any) matches.
                let entry = null
                for (const k of keys) if (k.key && timingSafeStringEqual(k.key, presented ?? "")) entry = k
                if (!entry) throw new Error("E_AUTH: a valid API key is required")
                const roles = entry.roles ?? []
                return { user: entry.user, roles, policies: policiesFor(appPolicies, roles), shares: [] }
            }
        } else {
            const policies = [...devPolicies(schemas), ...appPolicies]
            context = (req) => ({ user: req.headers["x-nexus-user"] || "dev", roles: ["dev"], policies, shares: [] })
        }
        api = createApi({ plane, endpoints: extensions.endpoints, context })
        authMode = keys.length ? `${keys.length} API keys (E_AUTH without one)` : "DEV identity — wide-open policies, user via x-nexus-user header"
    }

    const server = createServer(async (req, res) => {
        if (api && (await api(req, res))) return

        const url = new URL(req.url, "http://localhost")
        if (url.pathname === "/") {
            res.writeHead(200, { "content-type": MIME[".html"] })
            return res.end(indexPage(config, schemas))
        }
        // Framework modules for instance pages — /_nexus/src/* only,
        // resolved inside the Nexus package, traversal-guarded
        if (url.pathname.startsWith("/_nexus/")) {
            const path = resolve(NEXUS_ROOT, "." + url.pathname.slice("/_nexus".length))
            const allowed = path.startsWith(join(NEXUS_ROOT, "src"))
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
