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

/** The closed operator vocabulary — mirrors AST validate() exactly. */
const OPERATORS = ["eq", "ne", "gt", "gte", "lt", "lte", "like", "nlike", "in", "nin", "between", "isnull", "notnull"]

/**
 * The entity schema AS a function declaration (schema into schema): fields
 * become an enum, operators are the closed list, types/options/labels ride
 * in descriptions. FunctionGemma's chat template renders this structurally —
 * the model never sees a hand-rolled prose prompt. Pure — clause NL-12a.
 */
export function filterTool(schema) {
    const fields = (schema?.fields ?? []).filter((f) => f.type !== "table")
    const names = [...fields.map((f) => f.name), "id", "owner", "created_at", "updated_at"]
    const lines = fields.map((f) => {
        const labels = Object.values(f.label ?? {}).join(" / ")
        const opts = f.type === "select" ? ` options: [${f.options.join(", ")}]` : ""
        return `${f.name} (${f.type})${labels ? ` — "${labels}"` : ""}${opts}`
    })
    return {
        type: "function",
        function: {
            name: "filter_records",
            description: `Filter "${schema?.name}" records by the user's request. Pass filter:null for "everything". Include EVERY condition the user states — and/or between different conditions becomes a group.`,
            parameters: {
                type: "object",
                properties: {
                    filter: {
                        type: ["object", "null"],
                        description:
                            "A filter node — EITHER a leaf {field, operator, value} OR a group {op, children}. " +
                            `Fields: ${lines.join("; ")}. ` +
                            'Dates may use "$NOW", "$NOW(+1 day)", "$NOW(-1 day)". "like" values use % wildcards.',
                        properties: {
                            field: { type: "string", enum: names, description: "leaf: the field to test" },
                            operator: { type: "string", enum: OPERATORS, description: "leaf: the comparison" },
                            value: { description: "leaf: a scalar, or an array for in/nin/between" },
                            op: { type: "string", enum: ["and", "or", "not"], description: "group: the connective" },
                            children: { type: "array", description: "group: nested filter nodes of this same shape", items: { type: "object" } }
                        }
                    }
                },
                required: ["filter"]
            }
        }
    }
}

/**
 * Parse ONE FunctionGemma argument value at position i in `s`. The syntax is
 * JSON with bare keys and <escape>-delimited strings (the model's own output
 * contract). Returns [value, nextIndex]; throws E_NL_LLM on any malformed shape, including nesting past depth 32.
 */
function parseValue(s, i, depth = 0) {
    // a filter no schema could produce; past it the input is garbage, not a call
    if (depth > 32) throw err("E_NL_LLM", "the call nests too deeply")
    while (s[i] === " " || s[i] === "\n") i++
    if (s.startsWith("<escape>", i)) {
        const end = s.indexOf("<escape>", i + 8)
        if (end === -1) throw err("E_NL_LLM", "unterminated string in the call")
        return [s.slice(i + 8, end), end + 8]
    }
    if (s[i] === "{") {
        const value = {}
        i++
        while (true) {
            while (s[i] === " " || s[i] === "\n") i++
            if (s[i] === "}") return [value, i + 1]
            const colon = s.indexOf(":", i)
            if (colon === -1) throw err("E_NL_LLM", "a key without a value in the call")
            const key = s.slice(i, colon).trim()
            let v
            ;[v, i] = parseValue(s, colon + 1, depth + 1)
            value[key] = v
            while (s[i] === " " || s[i] === "\n") i++
            if (s[i] === ",") i++
            else if (s[i] !== "}") throw err("E_NL_LLM", "unbalanced object in the call")
        }
    }
    if (s[i] === "[") {
        const value = []
        i++
        while (true) {
            while (s[i] === " " || s[i] === "\n") i++
            if (s[i] === "]") return [value, i + 1]
            let v
            ;[v, i] = parseValue(s, i, depth + 1)
            value.push(v)
            while (s[i] === " " || s[i] === "\n") i++
            if (s[i] === ",") i++
            else if (s[i] !== "]") throw err("E_NL_LLM", "unbalanced array in the call")
        }
    }
    // a bare literal: null/true/false/number — or a bare word the model
    // forgot to escape, read as a string (never silently dropped)
    let j = i
    while (j < s.length && !",}]".includes(s[j])) j++
    const raw = s.slice(i, j).trim()
    if (!raw) throw err("E_NL_LLM", "an empty value in the call")
    if (raw === "null") return [null, j]
    if (raw === "true") return [true, j]
    if (raw === "false") return [false, j]
    const n = Number(raw)
    return [Number.isNaN(n) ? raw : n, j]
}

/**
 * FunctionGemma's structured output → AST document. STRICT: only a
 * `call:filter_records{…}` between the call markers is accepted — anything
 * else is E_NL_LLM (and the tier chain falls back). Pure — clause NL-12b.
 */
export function parseCall(text) {
    const s = String(text)
    const start = s.indexOf("<start_function_call>")
    const end = s.indexOf("<end_function_call>")
    if (start === -1 || end === -1 || end < start) throw err("E_NL_LLM", "the model returned no function call")
    const call = s.slice(start + "<start_function_call>".length, end).trim()
    const m = call.match(/^call:([A-Za-z_][\w]*)\s*\{/)
    if (!m) throw err("E_NL_LLM", "malformed function call")
    if (m[1] !== "filter_records") throw err("E_NL_LLM", `unknown function "${m[1]}"`)
    const [args, next] = parseValue(call, call.indexOf("{"))
    if (call.slice(next).trim()) throw err("E_NL_LLM", "trailing content after the call arguments")
    if (!("filter" in args)) throw err("E_NL_LLM", "the call carries no filter argument")
    return { astVersion: 1, root: args.filter }
}

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
Include EVERY condition the user states — "mà"/"và"/and = and-group, "hoặc"/or between different conditions = or-group.

Examples:
Q: high priority not finished
A: {"op":"and","children":[{"field":"priority","operator":"eq","value":"high"},{"field":"done","operator":"eq","value":false}]}
Q: việc ưu tiên cao hoặc thấp mà chưa xong
A: {"op":"and","children":[{"field":"priority","operator":"in","value":["high","low"]},{"field":"done","operator":"eq","value":false}]}
Q: quá hạn hoặc chưa hoàn thành
A: {"op":"or","children":[{"field":"due","operator":"lt","value":"$NOW"},{"field":"done","operator":"eq","value":false}]}
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
        // chat inputs may come back as the full message list — the reply is
        // the LAST assistant message's content; plain string passes through
        const generated = out[0].generated_text
        return typeof generated === "string" ? generated : generated.at(-1)?.content ?? ""
    }
}

export default { DEFAULT_NL_MODEL, filterTool, parseCall, schemaPrompt, extractAST, llmNLProvider, transformersGenerator }
