/** Permissions module — the role×Entity×action matrix (<nx-permission-manager>,
 *  which embeds <nx-query-builder> for row rules), saved to the app. */
import { el } from "../lib.js"

export function render(ctx) {
    const mgr = el("nx-permission-manager"); mgr.schemas = ctx.schemas
    const save = el("button", {
        class: "nx-btn primary", text: ctx.t("savePolicies"),
        onclick: async () => {
            const r = await ctx.api.studio("permissions", "POST", { policies: mgr.value })
            ctx.toast(r.ok ? "Policies saved — restart nexus dev to apply" : r.error.code + ": " + (r.error.message || ""), r.ok ? "ok" : "err")
        }
    })
    return el("div", {}, [
        el("div", { class: "nx-head" }, [el("h1", { text: ctx.t("permissions") }), el("span", { class: "nx-spacer" }), save]),
        el("div", { class: "nx-card" }, [mgr])
    ])
}
