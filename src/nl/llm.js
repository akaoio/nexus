/**
 * LLM NL→AST provider (§4.6f, tier 4) — a REAL local language model composes
 * AST documents the grammar and intent retrieval cannot: compound conditions,
 * novel phrasings, any language the model speaks. Architecture over features:
 *
 *   - `generate` is a SEAM: async ({ system, user }) => text. The default is
 *     transformers.js running a small multilingual instruct model locally
 *     (browser AND Node, offline once pulled) — but any generator plugs in.
 *   - the model NEVER gets authority: whatever text comes back is parsed by
 *     extractAST (strict JSON), then translate() validates it against the
 *     closed AST format and the schema vocabulary, and the Data Plane still
 *     injects permission — an LLM cannot invent a field or widen access
 *     (NL-02/NL-04 hold for every provider, this one included).
 *
 * Default model: Qwen2.5-0.5B-Instruct (ONNX) — small enough for the browser,
 * genuinely multilingual (Vietnamese included).
 */

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

export const DEFAULT_NL_MODEL = "onnx-community/Qwen2.5-0.5B-Instruct"

/**
 * The system prompt: the AST grammar as a contract + THIS entity's fields.
 * Pure — clause-tested. Few-shot examples anchor the output shape.
 */
export function schemaPrompt(schema) {
    const fields = (schema.fields ?? [])
        .filter((f) => f.type !== "table")
        .map((f) => {
            const labels = Object.values(f.label ?? {}).join(" / ")
            const opts = f.type === "select" ? ` options: [${f.options.join(", ")}]` : ""
            return `- ${f.name} (${f.type})${labels ? ` — "${labels}"` : ""}${opts}`
        })
        .join("\n")
    return `You translate a user's request about "${schema.name}" records into ONE JSON filter.

Fields (system fields id, owner, created_at, updated_at also exist):
${fields}

Filter language (recursive):
  leaf:  {"field": "<name>", "operator": "<op>", "value": <scalar or array>}
  group: {"op": "and"|"or"|"not", "children": [ ... ]}
Operators: eq ne gt gte lt lte like nlike in nin between isnull notnull.
"like" values use % wildcards. Dates may use "$NOW", "$NOW(+1 day)", "$NOW(-1 day)".
Answer with JSON ONLY — one object, no prose. Use null for "everything".

Examples:
Q: high priority not finished
A: {"op":"and","children":[{"field":"priority","operator":"eq","value":"high"},{"field":"done","operator":"eq","value":false}]}
Q: việc ưu tiên cao hoặc thấp mà chưa xong
A: {"op":"and","children":[{"field":"priority","operator":"in","value":["high","low"]},{"field":"done","operator":"eq","value":false}]}
Q: everything
A: null`
}

/**
 * Extract the FIRST JSON value from LLM text — tolerates \`\`\`json fences and
 * prose around it; throws E_NL_LLM when there is no parseable JSON. Pure.
 */
export function extractAST(text) {
    const cleaned = String(text).replace(/```(?:json)?/gi, "").trim()
    if (/^null\b/.test(cleaned)) return { astVersion: 1, root: null }
    const start = cleaned.indexOf("{")
    if (start === -1) throw err("E_NL_LLM", "the model returned no JSON")
    // scan to the matching brace (strings respected)
    let depth = 0
    let inString = false
    for (let i = start; i < cleaned.length; i++) {
        const ch = cleaned[i]
        if (inString) {
            if (ch === "\\") i++
            else if (ch === '"') inString = false
            continue
        }
        if (ch === '"') inString = true
        else if (ch === "{") depth++
        else if (ch === "}") {
            depth--
            if (depth === 0) {
                try {
                    return { astVersion: 1, root: JSON.parse(cleaned.slice(start, i + 1)) }
                } catch (error) {
                    throw err("E_NL_LLM", "unparseable JSON from the model: " + error.message)
                }
            }
        }
    }
    throw err("E_NL_LLM", "unbalanced JSON from the model")
}

/**
 * The provider: query + schema → AST document via a generator. translate()
 * downstream validates format and vocabulary — this function adds no trust.
 * @param {Object} config
 * @param {Function} config.generate - async ({ system, user }) => text
 */
export function llmNLProvider({ generate }) {
    if (typeof generate !== "function") throw err("E_NL_GENERATOR", "a generate({system,user}) function is required")
    return async (query, { schema } = {}) => {
        const text = await generate({ system: schemaPrompt(schema), user: String(query) })
        return extractAST(text)
    }
}

/**
 * The REAL local generator — transformers.js text-generation (chat template),
 * resolved from the INSTANCE's node_modules like every provider library (N2).
 * Works in Node and in the browser (WebGPU/WASM); weights cache locally, so
 * it is offline after the first pull.
 */
export async function transformersGenerator({ model = DEFAULT_NL_MODEL, root, onProgress } = {}) {
    const { createRequire } = await import("module")
    const { pathToFileURL } = await import("url")
    const { join } = await import("path")
    let lib
    try {
        lib = await import("@huggingface/transformers")
    } catch {
        try {
            const require = createRequire(join(root ?? process.cwd(), "package.json"))
            lib = await import(pathToFileURL(require.resolve("@huggingface/transformers")).href)
        } catch {
            throw err("E_PROVIDER", "the LLM provider needs its library — run: npm install @huggingface/transformers")
        }
    }
    const generator = await lib.pipeline("text-generation", model, { dtype: "q4", progress_callback: onProgress })
    return async ({ system, user }) => {
        const messages = [
            { role: "system", content: system },
            { role: "user", content: user }
        ]
        const out = await generator(messages, { max_new_tokens: 160, do_sample: false, return_full_text: false })
        return out[0].generated_text
    }
}

export default { DEFAULT_NL_MODEL, schemaPrompt, extractAST, llmNLProvider, transformersGenerator }
