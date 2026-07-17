/** AI models module — the embedding provider: status, and one-click switch.
 *  Weights are pulled from the terminal (nexus model pull). */
import { el } from "../lib.js"

export function render(ctx) {
    const body = el("div", { class: "nx-card" }, [el("p", { class: "nx-muted", text: "…" })])

    async function load() {
        const r = await ctx.api.studio("ai", "GET")
        const d = r.ok ? r.data : {}
        body.replaceChildren()
        body.append(el("p", { class: d.libInstalled ? "nx-muted" : "nx-err", text: "Mode: " + (d.mode || "?") + " · " + (d.libInstalled ? "library installed" : "library NOT installed — run: nexus model pull") }))
        for (const m of d.models || []) {
            const cur = m.id === d.model
            const use = el("button", { class: cur ? "nx-btn primary" : "nx-btn", text: cur ? "In use" : "Use", disabled: cur, onclick: async () => { await ctx.api.studio("ai", "POST", { model: m.id }); ctx.toast("Model set — restart nexus dev to apply"); load() } })
            body.append(el("div", { class: "nx-row" }, [el("div", { class: "nx-who" }, [el("div", { text: m.name }), el("div", { class: "nx-pub", text: m.dims + "d · " + m.langs + " · " + m.size + " · " + m.note })]), use]))
        }
        const none = el("button", { class: d.model ? "nx-btn" : "nx-btn primary", text: "Keyword only", disabled: !d.model, onclick: async () => { await ctx.api.studio("ai", "POST", { model: null }); ctx.toast("Switched to keyword search"); load() } })
        body.append(el("div", { class: "nx-toolbar", style: "margin-top:12px" }, [none]))
        body.append(el("p", { class: "nx-muted", style: "font-size:12px", text: "Download weights with the nexus model pull command (shows % + MB). Restart nexus dev to apply." }))
    }
    load()
    return el("div", {}, [el("div", { class: "nx-head" }, [el("h1", { text: ctx.t("ai", "AI models") })]), body])
}
