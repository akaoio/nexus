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
    "!=": "ne", "<>": "ne", not: "ne", "is not": "ne",
    ">": "gt", ">=": "gte", "<": "lt", "<=": "lte",
    "~": "like", like: "like", contains: "like",
    in: "in",
    before: "lt", after: "gt"
}

const NUMERIC = new Set(["integer", "number"])
const DATE_TYPES = new Set(["date", "datetime"])

/** Date words → AST dynamic variables (resolved later with the injected clock). */
const DATE_WORDS = {
    now: "$NOW", today: "$NOW",
    tomorrow: "$NOW(+1 day)", yesterday: "$NOW(-1 day)"
}

/** Coerce a raw token to the field's type (numbers for numeric fields, bools, date words). */
function coerce(field, raw) {
    let v = raw.trim()
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) return v.slice(1, -1)
    if (field && NUMERIC.has(field.type)) {
        const n = Number(v)
        if (!Number.isNaN(n)) return field.type === "integer" ? Math.trunc(n) : n
    }
    if (field?.type === "boolean") {
        const w = v.toLowerCase()
        if (w === "true" || w === "yes") return true
        if (w === "false" || w === "no") return false
    }
    if (field && DATE_TYPES.has(field.type)) {
        const dateWord = DATE_WORDS[v.toLowerCase()]
        if (dateWord) return dateWord
    }
    return v
}

/** Words that flip a named boolean to false — English and Vietnamese. */
const NEGATION = new Set([
    "not", "no", "non", "without", "isnt", "arent", "never", "un",
    "chưa", "chua", "không", "khong", "chẳng", "chang"
])

/** Unicode-safe word split (Vietnamese diacritics survive). */
const words = (text) => String(text).toLowerCase().split(/[^\p{L}\p{N}_]+/u).filter(Boolean)

/**
 * Field designators resolve case-insensitively by NAME or by any LABEL locale
 * ("Tiêu đề" → title). Returns { resolve(designator) → field|null, aliases(field) → [names…] }.
 */
function fieldIndex(fields) {
    const byAlias = new Map()
    const aliasesOf = new Map()
    for (const f of fields) {
        const aliases = [f.name.toLowerCase()]
        for (const label of Object.values(f.label ?? {})) aliases.push(String(label).toLowerCase())
        for (const alias of aliases) if (!byAlias.has(alias)) byAlias.set(alias, f)
        aliasesOf.set(f, [...new Set(aliases)])
    }
    return {
        resolve: (designator) => byAlias.get(designator.trim().toLowerCase()) ?? null,
        aliases: (f) => aliasesOf.get(f) ?? []
    }
}

/** Split on a connective word (and/or) OUTSIDE quotes, case-insensitively. */
function splitConnective(text, connective) {
    const parts = []
    let last = 0
    let quote = null
    for (let i = 0; i < text.length; i++) {
        const ch = text[i]
        if (quote) {
            if (ch === quote) quote = null
            continue
        }
        if (ch === '"' || ch === "'") {
            quote = ch
            continue
        }
        if (
            text.slice(i, i + connective.length).toLowerCase() === connective &&
            i > 0 && /\s/.test(text[i - 1]) &&
            /\s/.test(text[i + connective.length] ?? "")
        ) {
            parts.push(text.slice(last, i))
            i += connective.length
            last = i
        }
    }
    parts.push(text.slice(last))
    return parts.map((s) => s.trim()).filter(Boolean)
}

const CLAUSE_RE = /^(.+?)\s*(>=|<=|!=|<>|==|=|>|<|~)\s*(.+)$|^(.+?)\s+(is\s+not|is|not|like|contains|in|before|after)\s+(.+)$/i

/**
 * One `designator OP value` clause → leaf, or null. The designator resolves by
 * name or label; an identifier-looking unknown stays as-is so translate() can
 * reject it loudly (E_NL_FIELD) — anything else is not a clause.
 */
function parseClause(part, index) {
    const m = part.trim().match(CLAUSE_RE)
    if (!m) return null
    const designator = m[1] ?? m[4]
    const opRaw = (m[2] ?? m[5]).toLowerCase().replace(/\s+/g, " ")
    const valueRaw = m[3] ?? m[6]
    const operator = OP_WORDS[opRaw]
    if (!operator) return null
    const field = index.resolve(designator)
    const fieldName = field ? field.name : designator.trim()
    if (!field && !/^[a-z][a-z0-9_]*$/i.test(fieldName)) return null
    if (operator === "in") return { field: fieldName, operator: "in", value: valueRaw.replace(/^\[|\]$/g, "").split(",").map((s) => coerce(field, s)) }
    if (operator === "like") return { field: fieldName, operator: "like", value: `%${coerce(field, valueRaw)}%` }
    return { field: fieldName, operator, value: coerce(field, valueRaw) }
}

/** The strict grammar with precedence: or binds looser than and. */
function tryStrict(text, index) {
    const orChildren = []
    for (const orPart of splitConnective(text, "or")) {
        const andChildren = []
        for (const part of splitConnective(orPart, "and")) {
            const leaf = parseClause(part, index)
            if (!leaf) return null
            andChildren.push(leaf)
        }
        orChildren.push(andChildren.length === 1 ? andChildren[0] : { op: "and", children: andChildren })
    }
    if (!orChildren.length) return null
    return orChildren.length === 1 ? orChildren[0] : { op: "or", children: orChildren }
}

/**
 * Schema-aware natural reading (no model needed): a boolean field named in the
 * text — by NAME or LABEL — ⇒ `field = true` (false when a negation appears in
 * the two words before, or as an un- prefix: "not yet done", "undone", "chưa
 * xong"); a select option named ⇒ `field = option`, multi-word options matched
 * as phrases ("in progress"). Multiple hits ⇒ AND.
 */
function naturalParse(text, fields, index) {
    const tokens = words(text)
    const padded = ` ${tokens.join(" ")} `
    const leaves = []
    for (const f of fields.filter((f) => f.type === "boolean")) {
        for (const alias of index.aliases(f)) {
            let i = tokens.indexOf(alias)
            let negated = false
            if (i === -1 && tokens.includes(`un${alias}`)) {
                i = tokens.indexOf(`un${alias}`)
                negated = true
            }
            if (i === -1) continue
            const window = tokens.slice(Math.max(0, i - 2), i)
            if (window.some((w) => NEGATION.has(w))) negated = true
            leaves.push({ field: f.name, operator: "eq", value: !negated })
            break
        }
    }
    for (const f of fields.filter((f) => f.type === "select" && Array.isArray(f.options))) {
        const matched = f.options
            .filter((option) => {
                const phrase = words(String(option)).join(" ")
                return phrase && padded.includes(` ${phrase} `)
            })
            .sort((a, b) => padded.indexOf(` ${words(String(a)).join(" ")} `) - padded.indexOf(` ${words(String(b)).join(" ")} `))
        if (matched.length === 1) leaves.push({ field: f.name, operator: "eq", value: matched[0] })
        else if (matched.length > 1) leaves.push({ field: f.name, operator: "in", value: matched })
    }
    return leaves.length ? (leaves.length === 1 ? leaves[0] : { op: "and", children: leaves }) : null
}

/**
 * The STRICT grammar alone, as a document or null — for callers that must
 * not accept a fragment reading (a compound ask routed to an LLM): strict
 * parses the WHOLE text or nothing, while naturalParse happily reads one
 * clause out of a longer sentence.
 */
export function strictParse(query, schema) {
    const text = String(query).trim()
    if (!text) return { astVersion: 1, root: null }
    const index = fieldIndex(schema?.fields ?? [])
    const strict = tryStrict(text, index)
    return strict ? { astVersion: 1, root: strict } : null
}

/**
 * The deterministic default provider. First the strict `field OP value`
 * grammar (labels welcome, and/or with precedence, quoted values, date
 * words); if that doesn't fit, a schema-aware natural reading ("done tasks"
 * → done = true, "chưa xong" → done = false, "in progress" → status). Only
 * when neither understands the text does it throw E_NL_PARSE.
 */
export async function ruleProvider(query, { schema } = {}) {
    const text = String(query).trim()
    if (!text) return { astVersion: 1, root: null }
    const fields = schema?.fields ?? []
    const index = fieldIndex(fields)

    const strict = tryStrict(text, index)
    if (strict) return { astVersion: 1, root: strict }
    const natural = naturalParse(text, fields, index)
    if (natural) return { astVersion: 1, root: natural }
    throw err("E_NL_PARSE", `couldn't parse "${text}" — use "field = value" (e.g. done = true), or name a boolean field or a select option (e.g. "done tasks", "high priority")`)
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
