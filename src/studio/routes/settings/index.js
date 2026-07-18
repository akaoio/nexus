/** /settings route — the hub: general config (this file) plus the feature
 *  children, folders nested like the URL (/settings/ai, /settings/locales,
 *  /settings/themes — the akao routes shape). */

import { mountTemplate, button, toast } from "../../kit/index.js"
import { settingsTemplate } from "./template.js"
import * as ai from "./ai/index.js"
import * as locales from "./locales/index.js"
import * as themes from "./themes/index.js"

/** The settings children — the sidebar renders these under Settings. */
export const FEATURES = {
    ai: { icon: "stars", key: "ai", render: ai.render },
    locales: { icon: "translate", key: "languages", render: locales.render },
    themes: { icon: "circle-half", key: "themes", render: themes.render }
}

const section = (title, children) => {
    const wrap = document.createElement("div")
    wrap.className = "nx-setsec"
    const h = document.createElement("h3")
    h.textContent = title
    wrap.append(h, ...[].concat(children))
    return wrap
}

const field = (label, control) => {
    const wrap = document.createElement("div")
    wrap.className = "nx-field"
    wrap.style.maxWidth = "26.25rem"
    const l = document.createElement("label")
    l.className = "nx-label"
    l.textContent = label
    wrap.append(l, control)
    return wrap
}

const input = (props = {}) => {
    const node = document.createElement("input")
    node.className = "nx-input"
    Object.assign(node, props)
    return node
}

export function render(ctx) {
    // a child feature owns the whole page when the URL names it
    const feature = FEATURES[ctx.state.feature]
    if (feature) return feature.render(ctx)

    const c = {}
    const host = mountTemplate(settingsTemplate(c))

    async function load() {
        const r = await ctx.api.studio("config", "GET")
        const cfg = r.ok ? r.data.config : {}
        const set = async (key, value) => {
            const rr = await ctx.api.studio("config", "POST", { key, value })
            toast(rr.ok ? "Saved " + key + " — restart nexus dev to apply" : (rr.error && rr.error.code) || "error", rr.ok ? "ok" : "err")
        }
        c.$body.replaceChildren()

        const name = input({ value: cfg.site?.name ?? "" })
        name.addEventListener("change", () => set("site.name", name.value))
        const loc = document.createElement("select")
        loc.className = "nx-input"
        for (const code of ctx.i18n.locales) {
            const option = document.createElement("option")
            option.value = code
            option.textContent = ctx.i18n.names[code] || code
            option.selected = (cfg.site?.locale ?? "en") === code
            loc.append(option)
        }
        loc.addEventListener("change", () => set("site.locale", loc.value))
        c.$body.append(section("Site", [field("Name", name), field("Default locale", loc)]))

        const eng = document.createElement("select")
        eng.className = "nx-input"
        for (const e of ["sqlite", "turso", "postgres", "mysql"]) {
            const option = document.createElement("option")
            option.value = e
            option.textContent = e
            option.selected = (cfg.database?.engine ?? "sqlite") === e
            eng.append(option)
        }
        eng.addEventListener("change", () => set("database.engine", eng.value))
        c.$body.append(section("Database", [field("Engine (restart + install driver to apply)", eng)]))

        const model = document.createElement("p")
        model.className = "nx-muted"
        model.textContent = "Current: " + (cfg.semantic?.model ?? "none — switch it in the AI models panel")
        c.$body.append(section("AI model", [model]))

        const k = input({ placeholder: "dot.path e.g. site.locale" })
        const v = input({ placeholder: "value (JSON coerced)" })
        const apply = button({
            variant: "primary",
            onclick: async () => {
                let value = v.value
                try { value = JSON.parse(value) } catch {}
                await set(k.value.trim(), value)
                load()
            }
        }, ["Set"])
        const row = document.createElement("div")
        row.className = "nx-fields-row"
        row.append(k, v, apply)
        const out = document.createElement("pre")
        out.className = "nx-out"
        out.textContent = JSON.stringify(cfg, null, 2)
        c.$body.append(section("Advanced", [row, out]))
    }
    load()
    return host
}
