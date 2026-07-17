/**
 * Nexus Studio (v2) — the admin UI served by `nexus dev`. A real, mobile-first,
 * themeable app shell (not the earlier dogfood): a design system in CSS custom
 * properties, light/dark/auto theming with a header toggle, a collapsible
 * sidebar that becomes a drawer on phones, and every Studio web component wired
 * to the real API. Content types and permissions SAVE to the instance's files.
 *
 * This is a pure string generator (Node only, no DOM/engine imports); dev.js
 * serves the result and exposes /_studio/* write endpoints.
 */

export function studioPage(config, schemas, meta = {}) {
    const site = config.site?.name ?? "Nexus"
    const embedder = meta.embedder ?? { mode: "none" }
    const appName = meta.appName ?? "app"
    return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${site} — Studio</title>
<style>
:root{
  --bg:#f6f8fb; --surface:#ffffff; --surface-2:#eef2f7; --text:#0f172a; --muted:#64748b;
  --border:#dbe2ea; --primary:#0ea5e9; --primary-fg:#ffffff; --ok:#16a34a; --danger:#dc2626;
  --radius:10px; --shadow:0 1px 2px rgba(15,23,42,.06),0 8px 24px rgba(15,23,42,.06);
  --font:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;
  --sidebar:248px;
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --bg:#0b1120; --surface:#111827; --surface-2:#1a2333; --text:#e5edf7; --muted:#94a3b8;
  --border:#26324a; --primary:#38bdf8; --primary-fg:#04121e; --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35);
}}
:root[data-theme=dark]{
  --bg:#0b1120; --surface:#111827; --surface-2:#1a2333; --text:#e5edf7; --muted:#94a3b8;
  --border:#26324a; --primary:#38bdf8; --primary-fg:#04121e; --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px rgba(0,0,0,.35);
}
*{box-sizing:border-box}
html,body{margin:0;padding:0}
body{font-family:var(--font);background:var(--bg);color:var(--text);line-height:1.5;-webkit-text-size-adjust:100%}
a{color:var(--primary)}
button,select,input,textarea{font:inherit;color:inherit}
button{cursor:pointer}
.btn{border:1px solid var(--border);background:var(--surface);border-radius:8px;padding:7px 12px;display:inline-flex;gap:6px;align-items:center}
.btn:hover{border-color:var(--primary)}
.btn.primary{background:var(--primary);color:var(--primary-fg);border-color:var(--primary)}
.btn.icon{padding:7px 9px}
.badge{font-size:12px;padding:2px 9px;border-radius:999px;border:1px solid var(--border);color:var(--muted);white-space:nowrap}
.badge.dot::before{content:"";display:inline-block;width:7px;height:7px;border-radius:50%;background:var(--muted);margin-right:6px;vertical-align:middle}
.badge.on{color:var(--ok);border-color:color-mix(in srgb,var(--ok) 40%,var(--border))}
.badge.on.dot::before{background:var(--ok)}

/* app shell — mobile first (single column, sidebar is a drawer) */
header.top{position:sticky;top:0;z-index:30;display:flex;gap:12px;align-items:center;
  padding:10px 14px;background:color-mix(in srgb,var(--surface) 92%,transparent);
  backdrop-filter:saturate(1.4) blur(8px);border-bottom:1px solid var(--border)}
header.top .brand{font-weight:700;letter-spacing:.2px;display:flex;gap:8px;align-items:center}
header.top .brand small{color:var(--muted);font-weight:500}
header.top .spacer{flex:1}
.hamb{display:inline-flex}
.app{display:block}
aside.side{position:fixed;top:0;left:0;bottom:0;width:min(84vw,300px);z-index:50;background:var(--surface);
  border-right:1px solid var(--border);transform:translateX(-100%);transition:transform .2s ease;
  overflow-y:auto;padding:14px}
.app.open aside.side{transform:none}
.scrim{position:fixed;inset:0;background:rgba(2,6,23,.45);z-index:40;opacity:0;pointer-events:none;transition:opacity .2s}
.app.open .scrim{opacity:1;pointer-events:auto}
main.main{padding:16px 14px 60px}
.side .grouplabel{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin:14px 6px 6px}
.side nav a{display:flex;gap:9px;align-items:center;padding:8px 10px;border-radius:8px;color:inherit;text-decoration:none;cursor:pointer}
.side nav a:hover{background:var(--surface-2)}
.side nav a.active{background:color-mix(in srgb,var(--primary) 14%,transparent);color:var(--primary);font-weight:600}
.side nav a .ico{width:18px;text-align:center}

/* desktop: static sidebar grid */
@media (min-width:860px){
  .hamb{display:none}
  .app{display:grid;grid-template-columns:var(--sidebar) 1fr}
  aside.side{position:sticky;top:57px;height:calc(100vh - 57px);transform:none;width:auto;z-index:1}
  .scrim{display:none}
  main.main{padding:22px 26px 80px}
}

/* content */
.viewhead{display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-bottom:14px}
.viewhead h1{font-size:20px;margin:0}
.viewhead .spacer{flex:1}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);box-shadow:var(--shadow);padding:16px;margin-bottom:16px}
.toolbar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:12px}
.field{display:flex;flex-direction:column;gap:4px}
input.text,select.text,textarea.text{background:var(--surface);border:1px solid var(--border);border-radius:8px;padding:8px 10px;width:100%}
textarea.text{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13px}
.muted{color:var(--muted)}
.err{color:var(--danger);white-space:pre-wrap;margin:6px 0}
.ok{color:var(--ok)}
pre.out{background:var(--surface-2);border:1px solid var(--border);padding:12px;border-radius:8px;overflow:auto;font-size:12px;max-height:340px}
.collapse{display:none}
.collapse.show{display:block}
footer.foot{color:var(--muted);font-size:12px;border-top:1px solid var(--border);margin-top:24px;padding-top:14px}
footer.foot code{background:var(--surface-2);padding:.1em .4em;border-radius:5px}

/* drawer for the record form */
.drawer{position:fixed;inset:0;z-index:60;display:none}
.drawer.show{display:block}
.drawer .panel{position:absolute;top:0;right:0;bottom:0;width:min(94vw,460px);background:var(--surface);border-left:1px solid var(--border);box-shadow:var(--shadow);padding:18px;overflow-y:auto}
.drawer .back{position:absolute;inset:0;background:rgba(2,6,23,.45)}
.drawer .panel h2{margin:0 0 12px;font-size:16px}
</style>
</head><body>
<div class="app" id="app">
  <header class="top">
    <button class="btn icon hamb" id="hamb" aria-label="Menu">☰</button>
    <span class="brand">⬡ ${site} <small>Studio</small></span>
    <span class="spacer"></span>
    <span class="badge dot ${embedder.mode === "semantic" ? "on" : ""}" id="embadge" title="Embedding provider">…</span>
    <select class="btn" id="locale" aria-label="Language" title="Language" style="padding:7px 8px"></select>
    <button class="btn icon" id="theme" aria-label="Theme" title="Theme">🌗</button>
  </header>
  <div class="scrim" id="scrim"></div>
  <aside class="side">
    <div class="grouplabel" data-i18n="collections">Collections</div>
    <nav id="nav-collections"></nav>
    <div class="grouplabel" data-i18n="build">Build</div>
    <nav id="nav-build"></nav>
  </aside>
  <main class="main" id="main"></main>
</div>

<div class="drawer" id="drawer"><div class="back" id="drawer-back"></div>
  <div class="panel"><h2 id="drawer-title">New record</h2><div id="drawer-slot"></div></div>
</div>

<footer class="foot" style="padding:16px 26px 40px">Entities: ${schemas.map((s) => `<code>${s.name}</code>`).join(" · ") || "—"} — API: <code>GET/POST /api/v1/:entity</code> · <code>POST /api/v1/:entity/query</code> · <code>/search</code> · <code>/ask</code></footer>

<script type="application/json" id="boot">${JSON.stringify({ schemas, embedder, appName, i18n: meta.i18n ?? { dict: {}, names: {}, locales: ["en"] } })}</script>
<script type="module">
import "/_nexus/src/studio/query-builder.js"
import "/_nexus/src/studio/form-builder.js"
import "/_nexus/src/studio/permission-manager.js"
import "/_nexus/src/studio/schema-designer.js"
import "/_nexus/src/studio/list-view.js"
import "/_nexus/src/studio/search.js"

const boot = JSON.parse(document.getElementById("boot").textContent)
const schemas = boot.schemas
const $ = (id) => document.getElementById(id)
const el = (tag, props = {}, kids = []) => { const n = document.createElement(tag); Object.assign(n, props); for (const k of [].concat(kids)) n.append(k); return n }
const state = { entity: schemas[0] ? schemas[0].name : null, view: "content" }
const schemaOf = (name) => schemas.find((s) => s.name === name)

// ── theme (light / dark / auto) ───────────────────────────────────────────────
const THEMES = ["auto", "light", "dark"]
function applyTheme(t) {
  if (t === "auto") document.documentElement.removeAttribute("data-theme")
  else document.documentElement.setAttribute("data-theme", t)
  $("theme").textContent = t === "dark" ? "🌙" : t === "light" ? "☀️" : "🌗"
  $("theme").title = "Theme: " + t
}
let theme = localStorage.getItem("nexus-theme") || "auto"
applyTheme(theme)
$("theme").addEventListener("click", () => { theme = THEMES[(THEMES.indexOf(theme) + 1) % 3]; localStorage.setItem("nexus-theme", theme); applyTheme(theme) })

// ── i18n (translation memory — akao format, resolved at render) ────────────────
const i18n = boot.i18n || { dict: {}, names: {}, locales: ["en"] }
let locale = localStorage.getItem("nexus-locale")
const guess = (navigator.language || "en").slice(0, 2)
if (!i18n.locales.includes(locale)) locale = i18n.locales.includes(guess) ? guess : "en"
function t(key, fb) {
  const e = i18n.dict[key]
  const v = e && (e[locale] != null ? e[locale] : e.en)
  return v != null ? v : (fb != null ? fb : key)
}
const localeSel = $("locale")
localeSel.replaceChildren(...i18n.locales.map((c) => { const o = document.createElement("option"); o.value = c; o.textContent = i18n.names[c] || c; return o }))
function applyLocale() {
  localeSel.value = locale
  document.documentElement.lang = locale
  for (const el of document.querySelectorAll("[data-i18n]")) el.textContent = t(el.getAttribute("data-i18n"))
  renderNav()
  if (state.view && VIEWS[state.view]) VIEWS[state.view]()
}
localeSel.addEventListener("change", () => { locale = localeSel.value; localStorage.setItem("nexus-locale", locale); applyLocale() })

// ── embedder badge (honest status) ────────────────────────────────────────────
;(() => {
  const e = boot.embedder
  const b = $("embadge")
  if (e.mode === "semantic") { b.textContent = "semantic · " + (e.name || "model"); b.classList.add("on"); b.title = "Semantic search via " + e.name }
  else if (e.mode === "lexical") {
    if (e.wanted) { b.textContent = "lexical · model missing"; b.title = 'semantic.model="' + e.wanted + '" is set but @huggingface/transformers is not installed. Run: npm install @huggingface/transformers' }
    else if (e.semanticAvailable) { b.textContent = "lexical · enable model"; b.title = "A model library is installed — set semantic.model in nexus.config.json to switch to semantic search" }
    else { b.textContent = "lexical (keyword)"; b.title = "Keyword search only. Install @huggingface/transformers and set semantic.model for semantic search." }
  } else { b.textContent = "no embedder"; b.title = "No entity declares a semantic: block, so nothing is indexed for search." }
})()

// ── mobile drawer for the sidebar ─────────────────────────────────────────────
const closeSide = () => $("app").classList.remove("open")
$("hamb").addEventListener("click", () => $("app").classList.toggle("open"))
$("scrim").addEventListener("click", closeSide)

// ── API helpers ───────────────────────────────────────────────────────────────
async function post(path, body) {
  const r = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
  return r.json()
}
const apiQuery = (entity, filter) => post("/api/v1/" + entity + "/query", { filter, limit: 100 })
const apiCreate = (entity, data) => post("/api/v1/" + entity, data)
const apiAsk = (entity, query) => post("/api/v1/" + entity + "/ask", { query, limit: 100 })
const apiSearch = (entity, query) => post("/api/v1/" + entity + "/search", { query, mode: "hybrid" })

// ── navigation ────────────────────────────────────────────────────────────────
function renderNav() {
  const col = $("nav-collections"); col.replaceChildren()
  for (const s of schemas) {
    const a = el("a", { textContent: s.name })
    a.prepend(el("span", { className: "ico", textContent: "▤" }))
    if (state.view === "content" && state.entity === s.name) a.classList.add("active")
    a.addEventListener("click", () => go("content", s.name))
    col.append(a)
  }
  const build = $("nav-build"); build.replaceChildren()
  const items = [["model", "＋", t("dataModel")], ["permissions", "⚿", t("permissions")], ["search", "⌕", t("search")]]
  for (const [view, ico, label] of items) {
    const a = el("a", {})
    a.append(el("span", { className: "ico", textContent: ico }), document.createTextNode(label))
    if (state.view === view) a.classList.add("active")
    a.addEventListener("click", () => go(view))
    build.append(a)
  }
}
function go(view, entity) {
  state.view = view
  if (entity) state.entity = entity
  closeSide()
  renderNav()
  VIEWS[view]()
}

// ── VIEW: content (browse + create + filter + ask) ────────────────────────────
let listView = null, qbuilder = null
function viewContent() {
  const s = schemaOf(state.entity)
  const main = $("main"); main.replaceChildren()
  const count = el("span", { className: "muted", id: "c-count" })
  const newBtn = el("button", { className: "btn primary", textContent: "＋ " + t("newRecord") })
  newBtn.addEventListener("click", () => openRecordForm(s))
  const filterBtn = el("button", { className: "btn", textContent: "⚙ " + t("filter") })
  const head = el("div", { className: "viewhead" }, [el("h1", { textContent: s.name }), count, el("span", { className: "spacer" }), filterBtn, newBtn])

  const ask = el("input", { className: "text", placeholder: "Ask in plain language — e.g. done = false and points > 3" })
  ask.addEventListener("keydown", (e) => { if (e.key === "Enter") runAsk(ask.value) })
  const askBtn = el("button", { className: "btn", textContent: t("ask") + " → AST" })
  askBtn.addEventListener("click", () => runAsk(ask.value))
  const askRow = el("div", { className: "toolbar" }, [ask, askBtn])

  const bslot = el("div", { className: "collapse", id: "c-filter" })
  qbuilder = el("nx-query-builder"); qbuilder.schema = s
  let debounce = null
  qbuilder.addEventListener("change", (e) => { if (!e.detail.valid) return; clearTimeout(debounce); debounce = setTimeout(() => runQuery(), 250) })
  bslot.append(qbuilder)
  filterBtn.addEventListener("click", () => bslot.classList.toggle("show"))

  listView = el("nx-list-view"); listView.schema = s
  const err = el("div", { className: "err", id: "c-err" })
  main.append(head, el("div", { className: "card" }, [askRow, bslot]), err, listView)
  runQuery()
}
async function runQuery() {
  const body = await apiQuery(state.entity, qbuilder ? qbuilder.value : null)
  if (!body.ok) return ($("c-err").textContent = body.error.code + ": " + body.error.message)
  $("c-err").textContent = ""; setRows(body.data)
}
async function runAsk(query) {
  if (!query.trim()) return
  const body = await apiAsk(state.entity, query)
  if (!body.ok) return ($("c-err").textContent = body.error.code + ": " + body.error.message)
  $("c-err").textContent = ""
  const rows = Array.isArray(body.data) ? body.data : body.data.rows || []
  if (body.data && body.data.filter && qbuilder) qbuilder.value = body.data.filter
  setRows(rows, " · asked: “" + query + "”")
}
function setRows(rows, suffix = "") {
  listView.schema = schemaOf(state.entity); listView.rows = rows
  $("c-count").textContent = rows.length + (rows.length === 1 ? " record" : " records") + suffix
}
function openRecordForm(s) {
  $("drawer-title").textContent = "New " + s.name
  const slot = $("drawer-slot"); slot.replaceChildren()
  const form = el("nx-form"); form.schema = s
  form.addEventListener("submit", async (e) => {
    const body = await apiCreate(state.entity, e.detail.value)
    if (!body.ok) return alert(body.error.code + ": " + body.error.message)
    $("drawer").classList.remove("show"); runQuery()
  })
  slot.append(form)
  $("drawer").classList.add("show")
}
$("drawer-back").addEventListener("click", () => $("drawer").classList.remove("show"))

// ── VIEW: data model (view / edit / new — SAVES to a file) ────────────────────
function viewModel() {
  const main = $("main"); main.replaceChildren()
  const picker = el("select", { className: "text" }, [el("option", { value: "__new", textContent: "＋ " + t("newCollection") }), ...schemas.map((s) => el("option", { value: s.name, textContent: s.name }))])
  picker.value = state.entity || "__new"
  const head = el("div", { className: "viewhead" }, [el("h1", { textContent: t("dataModel") }), el("span", { className: "spacer" }), picker])
  const body = el("div", { id: "model-body" })
  const msg = el("div", { className: "ok", id: "model-msg" })
  main.append(head, body, msg)
  const mount = () => mountModel(picker.value, body)
  picker.addEventListener("change", mount)
  mount()
}
function mountModel(name, body) {
  body.replaceChildren()
  $("model-msg").textContent = ""
  if (name === "__new") {
    const nameInput = el("input", { className: "text", placeholder: "collection name (e.g. customer)" })
    const builder = el("nx-form-builder")
    const save = el("button", { className: "btn primary", textContent: t("createCollection") })
    save.addEventListener("click", () => saveModel({ ...(builder.value || { fields: [] }), name: nameInput.value.trim(), schemaVersion: 1 }))
    body.append(el("div", { className: "card" }, [el("div", { className: "field" }, [el("label", { className: "muted", textContent: t("name") }), nameInput]), el("p", { className: "muted", textContent: "Design the fields:" }), builder, el("div", { className: "toolbar" }, [save])]))
  } else {
    const designer = el("nx-schema-designer"); designer.baseline = schemaOf(name)
    const save = el("button", { className: "btn primary", textContent: t("saveChanges") })
    save.addEventListener("click", () => saveModel(designer.value))
    body.append(el("div", { className: "card" }, [designer, el("div", { className: "toolbar" }, [save])]))
  }
}
async function saveModel(schema) {
  if (!schema.name) return ($("model-msg").className = "err", $("model-msg").textContent = "A collection name is required")
  const body = await post("/_studio/model", schema)
  const m = $("model-msg")
  m.className = body.ok ? "ok" : "err"
  m.textContent = body.ok ? "Saved apps/" + boot.appName + "/models/" + schema.name + ".json — restart nexus dev to load it" : body.error.code + ": " + body.error.message
}

// ── VIEW: permissions (SAVES to a file) ───────────────────────────────────────
function viewPermissions() {
  const main = $("main"); main.replaceChildren()
  const mgr = el("nx-permission-manager"); mgr.schemas = schemas
  const save = el("button", { className: "btn primary", textContent: t("savePolicies") })
  const msg = el("div", { className: "ok", id: "perm-msg" })
  save.addEventListener("click", async () => {
    const body = await post("/_studio/permissions", { policies: mgr.value })
    msg.className = body.ok ? "ok" : "err"
    msg.textContent = body.ok ? "Saved apps/" + boot.appName + "/permissions/studio.json — restart nexus dev to apply" : body.error.code + ": " + body.error.message
  })
  main.append(el("div", { className: "viewhead" }, [el("h1", { textContent: t("permissions") }), el("span", { className: "spacer" }), save]), el("div", { className: "card" }, [mgr]), msg)
}

// ── VIEW: search ──────────────────────────────────────────────────────────────
function viewSearch() {
  const main = $("main"); main.replaceChildren()
  const note = boot.embedder.mode === "semantic" ? "Semantic search over " + boot.embedder.name : "Keyword search (no ML model configured — results rank by lexical overlap)"
  const search = el("nx-search"); search.schemas = schemas
  search.searcher = async ({ entity, query }) => { const b = await apiSearch(entity, query); return b.ok ? b.data : [] }
  main.append(el("div", { className: "viewhead" }, [el("h1", { textContent: t("search") }), el("span", { className: "spacer" }), el("span", { className: "badge", textContent: boot.embedder.mode })]), el("p", { className: "muted", textContent: note }), el("div", { className: "card" }, [search]))
}

const VIEWS = { content: viewContent, model: viewModel, permissions: viewPermissions, search: viewSearch }

go(state.entity ? "content" : "model", state.entity)
applyLocale()
</script>
</body></html>`
}

export default { studioPage }
