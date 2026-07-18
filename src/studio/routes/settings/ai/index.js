/** /ai route — logic: embedding model status and one-click switch. Weights
 *  are pulled from the terminal (nexus model pull). */

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
        for (const m of d.models || []) {
            const current = m.id === d.model
            const row = document.createElement("div")
            row.className = "nx-row"
            const who = document.createElement("div")
            who.className = "nx-who"
            const name = document.createElement("div")
            name.textContent = m.name
            const spec = document.createElement("div")
            spec.className = "nx-pub"
            spec.textContent = m.dims + "d · " + m.langs + " · " + m.size + " · " + m.note
            who.append(name, spec)
            const use = button({
                variant: current ? "primary" : undefined, disabled: current,
                onclick: async () => {
                    await ctx.api.studio("ai", "POST", { model: m.id })
                    toast("Model set — restart nexus dev to apply")
                    load()
                }
            }, [current ? "In use" : "Use"])
            row.append(who, use)
            c.$body.append(row)
        }
        const none = button({
            variant: d.model ? undefined : "primary", disabled: !d.model,
            onclick: async () => {
                await ctx.api.studio("ai", "POST", { model: null })
                toast("Switched to keyword search")
                load()
            }
        }, ["Keyword only"])
        const toolbar = document.createElement("div")
        toolbar.className = "nx-toolbar"
        toolbar.style.marginTop = "var(--sp-3)"
        toolbar.append(none)
        c.$body.append(toolbar, p("Download weights with the nexus model pull command (shows % + MB). Restart nexus dev to apply."))
    }
    load()
    return host
}
