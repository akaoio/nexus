/** /ai route — manages embedding and NL model status; one-click switch for each.
 *  Weights are pulled from the terminal (nexus model pull). */

import { mountTemplate, button, toast } from "../../../kit/index.js"
import { aiTemplate } from "./template.js"

export function render(ctx) {
    const c = {}
    const host = mountTemplate(aiTemplate(c))

    const p = (text, cls = "nx-muted") => {
        const node = document.createElement("p")
        node.className = cls
        node.textContent = text
        return node
    }

    async function load() {
        const r = await ctx.api.studio("ai", "GET")
        const d = r.ok ? r.data : {}
        c.$body.replaceChildren(
            p("Mode: " + (d.mode || "?") + " · " + (d.libInstalled ? "library installed" : "library NOT installed — run: nexus model pull"), d.libInstalled ? "nx-muted" : "nx-err")
        )
        section("Embedding", d.models || [], d.model, "model", "Keyword only", (m) => m.dims + "d · " + m.langs + " · " + m.size + " · " + m.note)
        section("NL (function calling)", d.nlModels || [], d.nlModel, "nlModel", "None — rule/retrieval tiers only", (m) => m.langs + " · " + m.size + " · " + m.note)
        c.$body.append(p("Download weights with the nexus model pull command (shows % + MB). Restart nexus dev to apply."))
    }

    // One model slot: a heading, a row per registry model, a clear button.
    function section(title, models, current, key, noneLabel, spec) {
        const h = document.createElement("h2")
        h.textContent = title
        c.$body.append(h)
        for (const m of models) {
            const active = m.id === current
            const row = document.createElement("div")
            row.className = "nx-row"
            const who = document.createElement("div")
            who.className = "nx-who"
            const name = document.createElement("div")
            name.textContent = m.name
            const detail = document.createElement("div")
            detail.className = "nx-pub"
            detail.textContent = spec(m)
            who.append(name, detail)
            const use = button({
                variant: active ? "primary" : undefined, disabled: active,
                onclick: async () => {
                    await ctx.api.studio("ai", "POST", { [key]: m.id })
                    toast("Model set — restart nexus dev to apply")
                    load()
                }
            }, [active ? "In use" : "Use"])
            row.append(who, use)
            c.$body.append(row)
        }
        const none = button({
            variant: current ? undefined : "primary", disabled: !current,
            onclick: async () => {
                await ctx.api.studio("ai", "POST", { [key]: null })
                toast(key === "model" ? "Switched to keyword search" : "NL tier off — rule/retrieval tiers remain")
                load()
            }
        }, [noneLabel])
        const toolbar = document.createElement("div")
        toolbar.className = "nx-toolbar"
        toolbar.style.marginTop = "var(--sp-3)"
        toolbar.append(none)
        c.$body.append(toolbar)
    }

    load()
    return host
}
