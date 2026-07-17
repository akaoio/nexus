/**
 * Semantic core — ARCHITECTURE.md §4.6 with the honest v1 baselines:
 *
 * - serializeRow: the schema-aware row→text of §4.6c — the `semantic:`
 *   block (template per locale + weighted embed fields) IS the
 *   serialization spec, declared in data, not code.
 * - hashProvider: a deterministic, zero-dependency LEXICAL provider —
 *   token-hash bag-of-words, L2-normalized. Real vectors, real lexical
 *   overlap, but NOT semantic (synonyms with no shared words score ~0). It
 *   is the honest offline fallback, not a fake. The SEMANTIC provider is
 *   src/semantic/transformers.js (a real ONNX model, EmbeddingGemma/MiniLM),
 *   an instance-side plugin with the SAME interface { name, dims,
 *   embed(texts) → vectors } (§4.6b: providers are pluggable, embeddings are
 *   derived data — never synced, always recomputable). See REM-* clauses.
 * - cosine + brute-force ranking: the §5.1 baseline ("local brute-force —
 *   đủ cho vài chục nghìn row"); ANN capabilities (sqlite-vec, pgvector,
 *   Turso native) upgrade per engine with the CI matrix, behind the same
 *   search() contract.
 * - rrf: Reciprocal Rank Fusion, k=60 (Cormack 2009) — rank-only, engine-
 *   portable, so hybrid fusion is CORE logic (§4.6d).
 */

// ─── serialization (§4.6c) ────────────────────────────────────────────────────

/** Row → text per the schema's semantic block. Deterministic and pure. */
export function serializeRow(schema, row, locale = "en") {
    const semantic = schema?.semantic
    const parts = []
    if (semantic?.template) {
        const template = semantic.template[locale] ?? semantic.template.en ?? Object.values(semantic.template)[0]
        if (template)
            parts.push(template.replace(/\{([a-z][a-z0-9_.]*)\}/g, (_, field) => {
                const value = row?.[field]
                return value === null || value === undefined ? "" : String(value)
            }))
    }
    for (const entry of semantic?.embed ?? []) {
        const value = row?.[entry.field]
        if (value === null || value === undefined) continue
        const weight = Math.max(1, Math.round(entry.weight ?? 1))
        for (let i = 0; i < weight; i++) parts.push(String(value))
    }
    if (!parts.length)
        for (const field of schema?.fields ?? []) {
            const value = row?.[field.name]
            if (typeof value === "string" && value) parts.push(value)
        }
    return parts.join("\n")
}

// ─── the deterministic dev/test embedding provider (§4.6b) ────────────────────

const tokenize = (text) =>
    String(text).toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((t) => t.length > 1)

function tokenHash(token) {
    let h = 5381
    for (let i = 0; i < token.length; i++) h = ((h << 5) + h + token.charCodeAt(i)) >>> 0
    return h
}

export function hashProvider(dims = 256) {
    return {
        name: "hash-bow",
        version: 1,
        dims,
        async embed(texts) {
            return texts.map((text) => {
                const vector = new Array(dims).fill(0)
                for (const token of tokenize(text)) vector[tokenHash(token) % dims] += 1
                const norm = Math.sqrt(vector.reduce((s, x) => s + x * x, 0)) || 1
                return vector.map((x) => x / norm)
            })
        }
    }
}

// ─── similarity & ranking ─────────────────────────────────────────────────────

export function cosine(a, b) {
    let dot = 0
    let na = 0
    let nb = 0
    for (let i = 0; i < a.length; i++) {
        dot += a[i] * b[i]
        na += a[i] * a[i]
        nb += b[i] * b[i]
    }
    const denominator = Math.sqrt(na) * Math.sqrt(nb)
    return denominator === 0 ? 0 : dot / denominator
}

/** Portable text scoring: query-token frequency over the serialized text. */
export function textScore(text, query) {
    const haystack = tokenize(text)
    if (!haystack.length) return 0
    const counts = new Map()
    for (const token of haystack) counts.set(token, (counts.get(token) ?? 0) + 1)
    let score = 0
    for (const token of new Set(tokenize(query))) score += counts.get(token) ?? 0
    return score / haystack.length
}

/**
 * Reciprocal Rank Fusion (k=60, Cormack 2009): rank-only — no score
 * normalization problem, fully engine-portable.
 * @param {Array<Array<string>>} rankings - Lists of ids, best first
 * @returns {Array<{id: string, score: number}>} Fused, best first
 */
export function rrf(rankings, k = 60) {
    const scores = new Map()
    for (const ranking of rankings)
        ranking.forEach((id, index) => scores.set(id, (scores.get(id) ?? 0) + 1 / (k + index + 1)))
    return [...scores.entries()].map(([id, score]) => ({ id, score })).sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
}

export default { serializeRow, hashProvider, cosine, textScore, rrf }
