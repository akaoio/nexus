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
import { existsSync, readFileSync, statSync, mkdirSync } from "fs"
import { join, resolve, extname } from "path"
import { DatabaseSync } from "node:sqlite"
import { loadInstance } from "../instance.js"
import { DataPlane } from "../../data/DataPlane.js"
import { createApi } from "../../http/api.js"
import { createCompiler } from "../../data/kysely.js"
import { tableDDL } from "../../data/ddl.js"
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

/** Wide-open DEV policies: every action at every permlevel, per entity. */
function devPolicies(schemas) {
    const policies = []
    for (const schema of schemas)
        for (let permlevel = 0; permlevel <= 9; permlevel++)
            policies.push({ entity: schema.name, actions: [...ACTIONS], rule: null, permlevel, ifOwner: false })
    return policies
}

function indexPage(config, schemas) {
    const rows = schemas
        .map(
            ({ name, fields }) =>
                `<li><strong>${name}</strong> — ${fields.length} fields · <code>GET /api/v1/${name}</code> · <code>POST /api/v1/${name}/query</code></li>`
        )
        .join("")
    return `<!doctype html><html><head><meta charset="utf-8"><title>${config.site?.name ?? "Nexus"}</title>
<style>body{font-family:system-ui;max-width:640px;margin:4rem auto;padding:0 1rem;line-height:1.6}code{background:#8882;padding:.1em .4em;border-radius:4px}</style>
</head><body>
<h1>⬡ ${config.site?.name ?? "Nexus"}</h1>
<p>This Nexus instance is up. Entities and their generated API:</p>
<ul>${rows || "<li>—</li>"}</ul>
<p>Endpoints per entity: <code>GET/POST /api/v1/:entity</code> · <code>GET/PATCH/DELETE /api/v1/:entity/:id</code> · <code>POST /api/v1/:entity/query</code> (Query AST)</p>
<p><code>nexus test</code> validates the schemas above.</p>
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
    const { config, schemas } = loadInstance(root)

    // Data Plane over a persistent local database, tables ensured from schemas
    let api = null
    if (schemas.length) {
        mkdirSync(join(root, ".nexus"), { recursive: true })
        const db = new DatabaseSync(join(root, ".nexus", "data.db"))
        const kysely = createCompiler("sqlite")
        for (const schema of schemas)
            for (const builder of tableDDL(kysely, schema, { ifNotExists: true })) db.exec(builder.compile().sql)
        const executor = {
            run: (sql, params = []) => void db.prepare(sql).run(...params),
            all: (sql, params = []) => db.prepare(sql).all(...params)
        }
        const plane = new DataPlane({ executor, schemas, dialect: "sqlite" })
        const policies = devPolicies(schemas)
        api = createApi({
            plane,
            context: (req) => ({ user: req.headers["x-nexus-user"] || "dev", roles: ["dev"], policies, shares: [] })
        })
    }

    const server = createServer(async (req, res) => {
        if (api && (await api(req, res))) return

        const url = new URL(req.url, "http://localhost")
        if (url.pathname === "/") {
            res.writeHead(200, { "content-type": MIME[".html"] })
            return res.end(indexPage(config, schemas))
        }
        // Static files — resolved path must stay inside the instance root
        const path = resolve(root, "." + url.pathname)
        if (!path.startsWith(root) || !existsSync(path) || !statSync(path).isFile()) {
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
        out.print(`  ${out.dim("auth")}  ${out.yellow("DEV identity")} — wide-open policies, user via x-nexus-user header`)
        out.print(`  ${out.dim("data")}  .nexus/data.db`)
    }
    out.emit({ ok: true, url, port: actual, entities: schemas.map((s) => s.name) })
    return server
}
