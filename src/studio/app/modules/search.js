/** Search module — global text/vector/hybrid search across readable Entities
 *  (<nx-search>), ranking inside permission. */
import { el } from "../lib.js"

export function render(ctx) {
    const search = el("nx-search")
    search.schemas = ctx.schemas
    search.searcher = async ({ entity, query }) => { const b = await ctx.api.search(entity, query); return b.ok ? b.data : [] }
    const note = ctx.embedder.mode === "semantic"
        ? "Semantic search via " + ctx.embedder.name
        : "Keyword search — configure a model in AI models for semantic ranking"
    return el("div", {}, [
        el("div", { class: "nx-head" }, [el("h1", { text: ctx.t("search") }), el("span", { class: "nx-spacer" }), el("span", { class: "nx-chip", text: ctx.embedder.mode })]),
        el("p", { class: "nx-muted", text: note }),
        el("div", { class: "nx-card" }, [search])
    ])
}
