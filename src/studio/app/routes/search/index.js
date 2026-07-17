/** /search route — logic: wires <nx-search> to the Data Plane search API. */

import { mountTemplate } from "../../lib.js"
import { searchTemplate } from "./template.js"

export function render(ctx) {
    const note = ctx.embedder.mode === "semantic"
        ? "Semantic search via " + ctx.embedder.name
        : "Keyword search — configure a model in AI models for semantic ranking"
    const c = {}
    const host = mountTemplate(searchTemplate(c, { mode: ctx.embedder.mode, note }))
    const search = document.createElement("nx-search")
    search.schemas = ctx.schemas
    search.searcher = async ({ entity, query }) => {
        const b = await ctx.api.search(entity, query)
        return b.ok ? b.data : []
    }
    c.$card.append(search)
    return host
}
