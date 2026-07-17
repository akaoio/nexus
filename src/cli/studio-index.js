/**
 * The Studio shell page — a THIN entry (not a monolith): it links the design
 * system, embeds boot data, and loads the real app (src/studio/app/app.js),
 * which composes the modules. Everything of substance lives in files under
 * src/studio/app/ (ARCHITECTURE §7.1). This function just serves the shell.
 */

export function studioIndex(config, schemas, meta = {}) {
    const site = config.site?.name ?? "Nexus"
    const boot = {
        site,
        schemas,
        appName: meta.appName ?? "app",
        embedder: meta.embedder ?? { mode: "none" },
        i18n: meta.i18n ?? { dict: {}, names: {}, locales: ["en"] }
    }
    return `<!doctype html><html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${site} — Studio</title>
<link rel="stylesheet" href="/_nexus/src/studio/app/studio.css">
</head><body>
<script type="application/json" id="nx-boot">${JSON.stringify(boot)}</script>
<script type="module" src="/_nexus/src/studio/app/app.js"></script>
<!-- API map (discoverable via view-source; not shown in the UI). Entities: ${schemas.map((s) => `<code>${s.name}</code>`).join(" ") || "—"} — endpoints: <code>GET/POST /api/v1/:entity</code> <code>POST /api/v1/:entity/query</code> <code>/api/v1/:entity/search</code> <code>/api/v1/:entity/ask</code> -->
</body></html>`
}

export default { studioIndex }
