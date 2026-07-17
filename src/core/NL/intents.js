/**
 * Schema → intent library (§4.6f) — the bridge that makes NL→AST REAL ML:
 * every Entity generates natural phrases (from its field names, labels in
 * every locale, and select options) paired with the AST each phrase means.
 * `embeddingNLProvider` embeds these with the REAL model (EmbeddingGemma…)
 * and retrieves the nearest intent for a free-text ask — so "việc đã hoàn
 * thành" lands on done = true through vector similarity, not string matching.
 *
 * Deterministic and derived: regenerate any time from the schema, nothing
 * hand-curated, nothing stored.
 */

const doc = (root) => ({ astVersion: 1, root })

/** Every name a field answers to: its name + every locale's label. */
const aliases = (field) => [field.name, ...Object.values(field.label ?? {})].map((a) => String(a).toLowerCase())

/** Entity display names: name + labels. */
const entityNames = (schema) => [schema.name, ...Object.values(schema.label ?? {})].map((s) => String(s).toLowerCase())

/**
 * Generate { phrase, ast } intents for one Entity.
 * @param {Object} schema - Model Schema v1
 * @returns {Array<{phrase: string, ast: Object}>}
 */
export function intentsFor(schema) {
    const intents = []
    const entities = entityNames(schema)
    const push = (phrase, root) => intents.push({ phrase, ast: doc(root) })

    // the whole collection
    for (const e of entities) {
        push(`all ${e}`, null)
        push(`tất cả ${e}`, null)
    }

    for (const field of schema.fields ?? []) {
        if (field.type === "boolean") {
            for (const a of aliases(field)) {
                for (const e of entities) {
                    push(`${e} ${a}`, { field: field.name, operator: "eq", value: true })
                    push(`${e} đã ${a}`, { field: field.name, operator: "eq", value: true })
                    push(`${e} not ${a}`, { field: field.name, operator: "eq", value: false })
                    push(`${e} chưa ${a}`, { field: field.name, operator: "eq", value: false })
                }
                push(`${a}`, { field: field.name, operator: "eq", value: true })
                push(`đã ${a}`, { field: field.name, operator: "eq", value: true })
                push(`hoàn thành`, { field: field.name, operator: "eq", value: true })
                push(`finished`, { field: field.name, operator: "eq", value: true })
                push(`not ${a} yet`, { field: field.name, operator: "eq", value: false })
                push(`chưa ${a}`, { field: field.name, operator: "eq", value: false })
                push(`unfinished`, { field: field.name, operator: "eq", value: false })
                push(`còn dang dở`, { field: field.name, operator: "eq", value: false })
            }
        }
        if (field.type === "select" && Array.isArray(field.options)) {
            for (const option of field.options) {
                for (const a of aliases(field)) {
                    push(`${a} ${option}`, { field: field.name, operator: "eq", value: option })
                    push(`${option} ${a}`, { field: field.name, operator: "eq", value: option })
                }
            }
        }
        if (field.type === "date" || field.type === "datetime") {
            for (const a of aliases(field)) {
                push(`${a} overdue`, { field: field.name, operator: "lt", value: "$NOW" })
                push(`${a} quá hạn`, { field: field.name, operator: "lt", value: "$NOW" })
                push(`${a} upcoming`, { field: field.name, operator: "gt", value: "$NOW" })
                push(`${a} sắp tới`, { field: field.name, operator: "gt", value: "$NOW" })
            }
            push("overdue", { field: field.name, operator: "lt", value: "$NOW" })
            push("quá hạn", { field: field.name, operator: "lt", value: "$NOW" })
        }
    }
    return intents
}

export default { intentsFor }
