/** Settings module — edit nexus.config.json from the UI (reuses /_studio/config,
 *  the same safe ops as `nexus config`). */
import { el } from "../../lib.js"

const sec = (title, kids) => el("div", { class: "nx-setsec" }, [el("h3", { text: title }), ...[].concat(kids)])
const fld = (label, input) => el("div", { class: "nx-field", style: "max-width:26.25rem" }, [el("label", { class: "nx-label", text: label }), input])

export function render(ctx) {
    const body = el("div", { class: "nx-card" }, [el("p", { class: "nx-muted", text: "…" })])

    async function load() {
        const r = await ctx.api.studio("config", "GET")
        const cfg = r.ok ? r.data.config : {}
        const set = async (key, value) => { const rr = await ctx.api.studio("config", "POST", { key, value }); ctx.toast(rr.ok ? "Saved " + key + " — restart nexus dev to apply" : (rr.error && rr.error.code) || "error", rr.ok ? "ok" : "err") }
        body.replaceChildren()
        const name = el("input", { class: "nx-input", value: (cfg.site && cfg.site.name) || "", onchange: (e) => set("site.name", e.target.value) })
        const loc = el("select", { class: "nx-input", onchange: (e) => set("site.locale", e.target.value) }, ctx.i18n.locales.map((c) => el("option", { value: c, text: ctx.i18n.names[c] || c, selected: ((cfg.site && cfg.site.locale) || "en") === c })))
        body.append(sec("Site", [fld("Name", name), fld("Default locale", loc)]))
        const eng = el("select", { class: "nx-input", onchange: (e) => set("database.engine", e.target.value) }, ["sqlite", "turso", "postgres", "mysql"].map((e) => el("option", { value: e, text: e, selected: ((cfg.database && cfg.database.engine) || "sqlite") === e })))
        body.append(sec("Database", [fld("Engine (restart + install driver to apply)", eng)]))
        body.append(sec("AI model", [el("p", { class: "nx-muted", text: "Current: " + ((cfg.semantic && cfg.semantic.model) || "none — switch it in the AI models panel") })]))
        const k = el("input", { class: "nx-input", placeholder: "dot.path e.g. site.locale" })
        const v = el("input", { class: "nx-input", placeholder: "value (JSON coerced)" })
        const setb = el("button", { class: "nx-btn primary", text: "Set", onclick: async () => { let val = v.value; try { val = JSON.parse(val) } catch {} await set(k.value.trim(), val); load() } })
        body.append(sec("Advanced", [el("div", { class: "nx-fields-row" }, [k, v, setb]), el("pre", { class: "nx-out", text: JSON.stringify(cfg, null, 2) })]))
    }
    load()
    return el("div", {}, [el("div", { class: "nx-head" }, [el("h1", { text: ctx.t("settings") })]), body])
}
