/** Entity module — the data model: create a new Entity or edit an existing one
 *  and SAVE (reuses <nx-form-builder> / <nx-schema-designer>). */
import { el } from "../lib.js"

export function render(ctx) {
    const picker = el("select", { class: "nx-input", style: "max-width:280px" },
        [el("option", { value: "__new", text: "＋ " + ctx.t("newCollection") }), ...ctx.schemas.map((s) => el("option", { value: s.name, text: s.name }))])
    picker.value = ctx.state.entity || "__new"
    const body = el("div")

    async function save(schema) {
        if (!schema || !schema.name) return ctx.toast("Entity name is required", "err")
        const r = await ctx.api.studio("model", "POST", { ...schema, schemaVersion: 1 })
        ctx.toast(r.ok ? "Entity saved — restart nexus dev to load it" : r.error.code + ": " + (r.error.message || ""), r.ok ? "ok" : "err")
    }
    function mount() {
        body.replaceChildren()
        if (picker.value === "__new") {
            const name = el("input", { class: "nx-input", placeholder: "Entity name (e.g. customer)" })
            const builder = el("nx-form-builder")
            const btn = el("button", { class: "nx-btn primary", text: ctx.t("createCollection"), onclick: () => save({ ...(builder.value || { fields: [] }), name: name.value.trim() }) })
            body.append(el("div", { class: "nx-card" }, [el("div", { class: "nx-field" }, [el("label", { class: "nx-label", text: ctx.t("name") }), name]), builder, el("div", { class: "nx-actions" }, [btn])]))
        } else {
            const designer = el("nx-schema-designer"); designer.baseline = ctx.schemas.find((s) => s.name === picker.value)
            const btn = el("button", { class: "nx-btn primary", text: ctx.t("saveChanges"), onclick: () => save(designer.value) })
            body.append(el("div", { class: "nx-card" }, [designer, el("div", { class: "nx-actions" }, [btn])]))
        }
    }
    picker.addEventListener("change", mount)
    mount()
    return el("div", {}, [el("div", { class: "nx-head" }, [el("h1", { text: ctx.t("dataModel") }), el("span", { class: "nx-spacer" }), picker]), body])
}
