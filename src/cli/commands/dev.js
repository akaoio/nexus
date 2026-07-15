/**
 * nexus dev — serve the current instance over HTTP. Zero dependencies:
 * Node's http module, nothing else (the akao dev.js lineage — no NGINX,
 * no Redis, no Supervisor). Skeleton scope: a static server plus a
 * generated index page describing the instance; HMR and the full app
 * runtime arrive with later phases.
 */

import { createServer } from "http"
import { existsSync, readFileSync, readdirSync, statSync } from "fs"
import { join, resolve, extname } from "path"

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

function indexPage(root) {
    const config = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
    const apps = []
    const appsDir = join(root, "apps")
    if (existsSync(appsDir))
        for (const app of readdirSync(appsDir)) {
            const modelsDir = join(appsDir, app, "models")
            const models = existsSync(modelsDir) ? readdirSync(modelsDir).filter((f) => f.endsWith(".json")) : []
            apps.push({ app, entities: models.map((m) => m.replace(/\.json$/, "")) })
        }
    const rows = apps
        .map(({ app, entities }) => `<li><strong>${app}</strong> — ${entities.length} entities: ${entities.join(", ") || "—"}</li>`)
        .join("")
    return `<!doctype html><html><head><meta charset="utf-8"><title>${config.site?.name ?? "Nexus"}</title>
<style>body{font-family:system-ui;max-width:640px;margin:4rem auto;padding:0 1rem;line-height:1.6}code{background:#8882;padding:.1em .4em;border-radius:4px}</style>
</head><body>
<h1>⬡ ${config.site?.name ?? "Nexus"}</h1>
<p>This Nexus instance is up. Apps installed:</p>
<ul>${rows || "<li>—</li>"}</ul>
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

    const server = createServer((req, res) => {
        const url = new URL(req.url, "http://localhost")
        if (url.pathname === "/") {
            res.writeHead(200, { "content-type": MIME[".html"] })
            return res.end(indexPage(root))
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

    await new Promise((ready, fail) => {
        server.once("error", fail)
        server.listen(port, ready)
    })
    const actual = server.address().port
    const url = `http://localhost:${actual}`
    out.print(`${out.green("⬡")} Nexus dev · ${out.cyan(url)}  ${out.dim("(Ctrl+C to stop)")}`)
    // In --json mode the document is emitted once the server is listening
    out.emit({ ok: true, url, port: actual })
    return server
}
