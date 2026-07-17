/**
 * Natural language → Query AST (ARCHITECTURE.md §4.6f) — the capstone of
 * "a system that understands data", built so it can NEVER be an injection or
 * a permission hole: whatever a provider returns is VALIDATED against the
 * schema and then runs through the exact same compile + permission pipeline
 * as any hand-built query. An LLM cannot invent a field, forge an operator,
 * or reach a row the caller may not see — the AST is the choke point.
 *
 * A provider is `async (query, { schema }) => astDocument`. The default
 * `ruleProvider` is a deterministic mini-parser over a constrained grammar —
 * enough to prove the round-trip and to serve offline — exactly as the
 * semantic layer ships a deterministic embedding provider; a real LLM
 * provider plugs in with the same signature.
 */

import * as AST from "../ast/AST.js"
import { cosine } from "../semantic/semantic.js"

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

const OP_WORDS = {
    "=": "eq", "==": "eq", is: "eq",
    "!=": "ne", "<>": "ne", not: "ne",
    ">": "gt", ">=": "gte", "<": "lt", "<=": "lte",
    "~": "like", like: "like", contains: "like",
    in: "in"
}

const NUMERIC = new Set(["integer", "number"])

/** Coerce a raw token to the field's type (numbers for numeric fields, bools). */
function coerce(field, raw) {
    let v = raw.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1)
    if (field && NUMERIC.has(field.type)) {
        const n = Number(v)
        if (!Number.isNaN(n)) return field.type === "integer" ? Math.trunc(n) : n
    }
    if (field?.type === "boolean") {
        if (v === "true") return true
        if (v === "false") return false
    }
    return v
}

/**
 * The deterministic default provider: parses `field OP value` clauses joined
 * by `and` / `or` (single connective per query) into an AST document.
 * `contains`/`~` becomes a %value% LIKE. Unknown shapes throw E_NL_PARSE.
 */
export async function ruleProvider(query, { schema } = {}) {
    const text = String(query).trim()
    if (!text) return { astVersion: 1, root: null }
    const byName = new Map((schema?.fields ?? []).map((f) => [f.name, f]))

    const connective = /\s+\bor\b\s+/i.test(text) ? "or" : "and"
    const parts = text.split(new RegExp(`\\s+\\b${connective}\\b\\s+`, "i"))
    const leaves = parts.map((part) => {
        const m = part.trim().match(/^([a-z][a-z0-9_]*)\s*(>=|<=|!=|<>|==|=|>|<|~|\bis\b|\bnot\b|\blike\b|\bcontains\b|\bin\b)\s*(.+)$/i)
        if (!m) throw err("E_NL_PARSE", `cannot parse clause "${part.trim()}"`)
        const [, fieldName, opRaw, valueRaw] = m
        const operator = OP_WORDS[opRaw.toLowerCase()]
        if (!operator) throw err("E_NL_PARSE", `unknown operator "${opRaw}"`)
        const field = byName.get(fieldName)
        if (operator === "in") {
            const items = valueRaw.replace(/^\[|\]$/g, "").split(",").map((s) => coerce(field, s))
            return { field: fieldName, operator: "in", value: items }
        }
        if (operator === "like") return { field: fieldName, operator: "like", value: `%${coerce(field, valueRaw)}%` }
        return { field: fieldName, operator, value: coerce(field, valueRaw) }
    })

    const root = leaves.length === 1 ? leaves[0] : { op: connective, children: leaves }
    return { astVersion: 1, root }
}

/**
 * A REAL embedding-retrieval NL provider (§4.6f): the app supplies a library
 * of { phrase, ast } intents; the query is embedded (a real model) and the
 * nearest intent by cosine wins, above `threshold`. Semantically-phrased
 * queries with no keyword overlap still match the right intent — this is the
 * real EmbeddingGemma-powered NL→AST, not a parser. Below threshold throws
 * E_NL_NOMATCH so an unrecognized ask never guesses. `threshold` is
 * model-dependent (0.3 suits all-MiniLM: real paraphrases score ~0.35–0.55,
 * unrelated text ~0.1); tune it per model.
 * @param {Object} config
 * @param {Array<{phrase: string, ast: Object}>} config.examples
 * @param {{embed(texts): Promise<number[][]>}} config.embedder
 * @param {number} [config.threshold=0.3]
 * @returns {Function} a provider (query, { schema }) => astDocument
 */
export function embeddingNLProvider({ examples, embedder, threshold = 0.3 }) {
    if (!Array.isArray(examples) || !examples.length) throw err("E_NL_EXAMPLES", "an intent library is required")
    let indexed = null
    return async (query) => {
        if (!indexed) indexed = await embedder.embed(examples.map((e) => e.phrase))
        // The ask is a retrieval query; intents were embedded as documents.
        const encodeQuery = embedder.embedQuery ?? embedder.embed
        const [q] = await encodeQuery.call(embedder, [String(query)])
        let best = -1
        let bestIndex = -1
        for (let i = 0; i < indexed.length; i++) {
            const c = cosine(q, indexed[i])
            if (c > best) {
                best = c
                bestIndex = i
            }
        }
        if (best < threshold) throw err("E_NL_NOMATCH", `no intent matched (nearest ${best.toFixed(2)} < ${threshold})`)
        return examples[bestIndex].ast
    }
}

/**
 * Translate natural language into a validated Query AST document for an
 * entity. The provider's output is checked against the closed AST format AND
 * against the schema's fields (system fields allowed) — an unknown field is
 * E_NL_FIELD, an invalid document is E_NL_AST. The returned document is safe
 * to hand to DataPlane.list(): permission injection still applies downstream,
 * so this never widens access.
 * @param {string} query
 * @param {Object} schema - Model Schema v1 document (the field vocabulary)
 * @param {Function} [provider=ruleProvider]
 */
export async function translate(query, schema, provider = ruleProvider) {
    const document = await provider(query, { schema })
    const result = AST.validate(document)
    if (!result.valid) throw err("E_NL_AST", JSON.stringify(result.errors))

    const known = new Set([
        "id", "owner", "created_at", "updated_at",
        ...(schema?.fields ?? []).filter((f) => f.type !== "table").map((f) => f.name)
    ])
    const walk = (node) => {
        if (!node) return
        if (node.op) return node.children.forEach(walk)
        const base = node.field.split(".")[0]
        if (!known.has(base)) throw err("E_NL_FIELD", `unknown field "${node.field}"`)
    }
    walk(document.root)
    return document
}

export default { ruleProvider, translate }
