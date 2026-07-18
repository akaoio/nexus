/**
 * LLM NL→AST provider (§4.6f, tier 4) — a REAL local language model composes
 * AST documents the grammar and intent retrieval cannot: compound conditions,
 * novel phrasings, any language the model speaks. Architecture over features:
 *
 *   - `generate` is a SEAM: async ({ tools, user }) => text. The schema travels
 *     as a TOOL DECLARATION ({tools}), never as prose. The default is transformers.js
 *     running FunctionGemma-270M locally (browser AND Node, offline once pulled)
 *     — but any generator plugs in.
 *   - the model NEVER gets authority: whatever text comes back is parsed by
 *     parseCall (strict FunctionGemma call syntax), then translate() validates it
 *     against the closed AST format and the schema vocabulary, and the Data Plane
 *     still injects permission — an LLM cannot invent a field or widen access
 *     (NL-02/NL-04 hold for every provider, this one included).
 *
 * Default model: FunctionGemma-270M ONNX — small, multilingual, structured output.
 */

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

export const DEFAULT_NL_MODEL = "onnx-community/functiongemma-270m-it-ONNX"

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
 * The provider: query + schema → AST document via a generator. The schema
 * travels as a TOOL DECLARATION ({tools}), never as prose; translate()
 * downstream validates format and vocabulary — this function adds no trust.
 * @param {Object} config
 * @param {Function} config.generate - async ({ tools, user }) => text
 */
export function llmNLProvider({ generate }) {
    if (typeof generate !== "function") throw err("E_NL_GENERATOR", "a generate({tools,user}) function is required")
    return async (query, { schema } = {}) => {
        const text = await generate({ tools: [filterTool(schema)], user: String(query) })
        return parseCall(text)
    }
}

/**
 * The REAL local generator — FunctionGemma via transformers.js, resolved from
 * the INSTANCE's node_modules like every provider library (N2). Tools go
 * through apply_chat_template({ tools }) — the template renders the
 * declarations structurally; pipeline() cannot do this, so the tokenizer and
 * model are driven directly. Decoding keeps special tokens: the
 * <start_function_call> markers ARE the output contract parseCall reads.
 */
export async function functionGemmaGenerator({ model = DEFAULT_NL_MODEL, root, onProgress } = {}) {
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
    const tokenizer = await lib.AutoTokenizer.from_pretrained(model, { progress_callback: onProgress })
    const lm = await lib.AutoModelForCausalLM.from_pretrained(model, { progress_callback: onProgress })
    return async ({ tools, user }) => {
        const messages = [
            { role: "developer", content: "You are a model that can do function calling with the following functions" },
            { role: "user", content: String(user) }
        ]
        const inputs = tokenizer.apply_chat_template(messages, { tools, add_generation_prompt: true, return_dict: true })
        const output = await lm.generate({ ...inputs, max_new_tokens: 256, do_sample: false })
        return tokenizer.decode(output.slice(0, [inputs.input_ids.dims[1], null]), { skip_special_tokens: false })
    }
}

export default { DEFAULT_NL_MODEL, filterTool, parseCall, llmNLProvider, functionGemmaGenerator }
