# FunctionGemma NL Tier Implementation Plan

> **Superseded in detail:** the shipped `filterTool` speaks the template's dialect (string types + `nullable`, commit 1afb836) and `parseValue` bounds nesting depth (f2bc161) — the code blocks below predate those review fixes.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the prompt-text Qwen NL→AST tier with FunctionGemma-270M ONNX, passing the entity schema as a structured `tools` declaration through the chat template.

**Architecture:** `src/core/NL/llm.js` is rewritten around three units: `filterTool(schema)` (pure — Model Schema → function declaration), `parseCall(text)` (pure — FunctionGemma call syntax → AST document), and `functionGemmaGenerator` (seam — AutoTokenizer/AutoModelForCausalLM with `tools` in `apply_chat_template`; `pipeline()` cannot pass tools). `llmNLProvider` keeps its role and signature. Downstream `translate()` validation and permission injection are untouched — the model still has zero authority (NL-02/NL-04).

**Tech Stack:** @huggingface/transformers (v4, instance-side per N2), onnx-community/functiongemma-270m-it-ONNX, custom Test harness (`node test.js <filter>`).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-18-functiongemma-nl-design.md` — replace entirely, no shims, no second code path.
- N2 rule: `@huggingface/transformers` resolves from the INSTANCE's node_modules (fallback via `createRequire(join(root, "package.json"))`), never a kernel dependency.
- Error codes are a public contract: model/parse failures are `E_NL_LLM`; a missing generate function is `E_NL_GENERATOR`.
- Tests run with `node test.js nl` (suite filter); the full suite is `node test.js`.
- Comment style: explain the WHY at declaration site, akao voice, no change-log comments.
- Branch: `functiongemma-nl` (already created; spec committed).

---

### Task 1: `filterTool(schema)` — the function declaration

**Files:**
- Modify: `src/core/NL/llm.js` (add `filterTool`; old exports stay until Task 3)
- Test: `test/nl/nl.test.js` (add NL-12a after the existing NL-12 block, line ~157)

**Interfaces:**
- Consumes: Model Schema v1 documents (`schema.name`, `schema.fields[]` with `name/type/label/options`).
- Produces: `filterTool(schema)` → `{ type: "function", function: { name: "filter_records", description, parameters } }`. Tasks 3–4 pass `[filterTool(schema)]` as `tools`. The declaration's `parameters.properties.filter` is the recursive NODE schema; `field` enum = non-table field names + `id, owner, created_at, updated_at`; `operator` enum = the closed 13-operator list.

- [ ] **Step 1: Write the failing test** — append inside the `Test.describe("NL→AST (NL-*)")` block, right after the NL-12 `Test.it`:

```js
    Test.it("NL-12a the LLM tier declares the schema AS SCHEMA: filterTool is a complete function declaration", async () => {
        const { filterTool } = await import("../../src/core/NL/llm.js")
        const tool = filterTool(TASK)
        assert.equal(tool.type, "function")
        assert.equal(tool.function.name, "filter_records")
        const params = tool.function.parameters
        assert.deepEqual(params.required, ["filter"])
        const node = params.properties.filter
        // the field vocabulary is an ENUM — the model cannot be offered a field that doesn't exist
        for (const name of ["title", "done", "priority", "points", "due", "status", "secret", "id", "owner", "created_at", "updated_at"])
            assert.truthy(node.properties.field.enum.includes(name), `field enum carries ${name}`)
        assert.truthy(!node.properties.field.enum.includes("ghost"), "no invented fields")
        // the closed operator list, verbatim
        assert.deepEqual(node.properties.operator.enum, ["eq", "ne", "gt", "gte", "lt", "lte", "like", "nlike", "in", "nin", "between", "isnull", "notnull"])
        // groups: op enum + children of the same shape
        assert.deepEqual(node.properties.op.enum, ["and", "or", "not"])
        assert.equal(node.properties.children.type, "array")
        // types, options, labels and date variables ride in descriptions
        const prose = JSON.stringify(tool)
        for (const must of ["low, medium, high", "Tiêu đề", "$NOW", "priority (select)"])
            assert.truthy(prose.includes(must), `declaration carries ${JSON.stringify(must)}`)
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test.js nl`
Expected: FAIL — `filterTool` is not exported.

- [ ] **Step 3: Implement `filterTool` in `src/core/NL/llm.js`** — add below `DEFAULT_NL_MODEL` (leave `schemaPrompt` in place for now):

```js
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
                        type: "object",
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test.js nl`
Expected: PASS (all NL-* including the old NL-12).

- [ ] **Step 5: Commit**

```bash
git add src/core/NL/llm.js test/nl/nl.test.js
git commit -m "NL tier 4: filterTool — the entity schema as a function declaration"
```

---

### Task 2: `parseCall(text)` — FunctionGemma output → AST document

**Files:**
- Modify: `src/core/NL/llm.js` (add `parseCall` + private argument parser)
- Test: `test/nl/nl.test.js` (add NL-12b after NL-12a)

**Interfaces:**
- Consumes: raw decoded model text containing `<start_function_call>call:filter_records{…}<end_function_call>`; strings inside args are `<escape>`-delimited; keys are bare; numbers/booleans/null are bare literals; objects/arrays nest with `{}`/`[]`.
- Produces: `parseCall(text)` → `{ astVersion: 1, root }` (root `null` for `filter:null`). Throws `E_NL_LLM` on: no call markers, a function other than `filter_records`, unparseable/unbalanced args, or a missing `filter` key. Task 3's `llmNLProvider` calls this.

- [ ] **Step 1: Write the failing test** — append after NL-12a:

```js
    Test.it("NL-12b parseCall reads FunctionGemma call syntax strictly — and feeds the SAME choke point", async () => {
        const { parseCall } = await import("../../src/core/NL/llm.js")
        const wrap = (args) => `<start_function_call>call:filter_records{${args}}<end_function_call>`
        // a leaf: escape-delimited strings, bare keys
        assert.deepEqual(
            parseCall(wrap("filter:{field:<escape>priority<escape>,operator:<escape>eq<escape>,value:<escape>high<escape>}")),
            { astVersion: 1, root: { field: "priority", operator: "eq", value: "high" } })
        // a nested group with an array value and bare literals
        assert.deepEqual(
            parseCall(wrap("filter:{op:<escape>and<escape>,children:[{field:<escape>priority<escape>,operator:<escape>in<escape>,value:[<escape>high<escape>,<escape>low<escape>]},{field:<escape>done<escape>,operator:<escape>eq<escape>,value:false}]}")),
            { astVersion: 1, root: { op: "and", children: [
                { field: "priority", operator: "in", value: ["high", "low"] },
                { field: "done", operator: "eq", value: false }
            ] } })
        // numbers stay numbers; null filter means "everything"
        assert.deepEqual(parseCall(wrap("filter:{field:<escape>points<escape>,operator:<escape>gt<escape>,value:3}")).root.value, 3)
        assert.deepEqual(parseCall(wrap("filter:null")), { astVersion: 1, root: null })
        // strictness: no call, wrong function, broken args, missing filter — all E_NL_LLM
        await Test.assert.rejects(Promise.resolve().then(() => parseCall("I cannot help with that")), "E_NL_LLM")
        await Test.assert.rejects(Promise.resolve().then(() => parseCall("<start_function_call>call:drop_tables{filter:null}<end_function_call>")), "E_NL_LLM")
        await Test.assert.rejects(Promise.resolve().then(() => parseCall(wrap("filter:{field:<escape>done<escape>"))), "E_NL_LLM")
        await Test.assert.rejects(Promise.resolve().then(() => parseCall(wrap("verbose:true"))), "E_NL_LLM")
        // whatever parses still dies in translate() when it names a ghost field
        const provider = async () => parseCall(wrap("filter:{field:<escape>ghost<escape>,operator:<escape>eq<escape>,value:1}"))
        await Test.assert.rejects(translate("anything", TASK, provider), "E_NL_FIELD")
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test.js nl`
Expected: FAIL — `parseCall` is not exported.

- [ ] **Step 3: Implement `parseCall` in `src/core/NL/llm.js`** — add below `filterTool` (leave `extractAST` in place for now):

```js
/**
 * Parse ONE FunctionGemma argument value at position i in `s`. The syntax is
 * JSON with bare keys and <escape>-delimited strings (the model's own output
 * contract). Returns [value, nextIndex]; throws on any malformed shape.
 */
function parseValue(s, i) {
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
            ;[v, i] = parseValue(s, colon + 1)
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
            ;[v, i] = parseValue(s, i)
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node test.js nl`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/NL/llm.js test/nl/nl.test.js
git commit -m "NL tier 4: parseCall — strict FunctionGemma call syntax to AST"
```

---

### Task 3: rewire `llmNLProvider`; delete the prompt-text halves

**Files:**
- Modify: `src/core/NL/llm.js` (rewrite `llmNLProvider`, delete `schemaPrompt` + `extractAST`, update the header comment, `DEFAULT_NL_MODEL`, and the default export)
- Test: `test/nl/nl.test.js` (delete the old NL-12 `Test.it` entirely; extend NL-12b's name is NOT needed — add the provider round-trip to NL-12a's file section as NL-12c below)

**Interfaces:**
- Consumes: `filterTool` (Task 1), `parseCall` (Task 2).
- Produces: `llmNLProvider({ generate })` where `generate` is `async ({ tools, user }) => text`; returns a provider `(query, { schema }) => astDocument`. Task 4's generator must match this `{ tools, user }` seam.

- [ ] **Step 1: Write the failing test** — REPLACE the old `Test.it("NL-12 …")` block (lines ~142–157 of `test/nl/nl.test.js`) with:

```js
    Test.it("NL-12 the provider seam: schema in as TOOLS, call text out, parsed and choke-pointed", async () => {
        const { llmNLProvider } = await import("../../src/core/NL/llm.js")
        // the generate seam receives the schema AS a tool declaration — never prose
        let seen = null
        const provider = llmNLProvider({
            generate: async ({ tools, user }) => {
                seen = { tools, user }
                return "<start_function_call>call:filter_records{filter:{field:<escape>done<escape>,operator:<escape>eq<escape>,value:false}}<end_function_call>"
            }
        })
        const document = await provider("việc chưa xong", { schema: TASK })
        assert.deepEqual(document, { astVersion: 1, root: { field: "done", operator: "eq", value: false } })
        assert.equal(seen.user, "việc chưa xong")
        assert.equal(seen.tools.length, 1)
        assert.equal(seen.tools[0].function.name, "filter_records")
        await Test.assert.rejects(Promise.resolve().then(() => llmNLProvider({})), "E_NL_GENERATOR")
    })
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node test.js nl`
Expected: FAIL — `llmNLProvider` still calls `generate({ system, user })` and `extractAST`, so `seen.tools` is undefined.

- [ ] **Step 3: Rewrite `llmNLProvider`; delete `schemaPrompt` and `extractAST`** in `src/core/NL/llm.js`:

Replace the `llmNLProvider` body:

```js
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
```

Delete the whole `schemaPrompt` function and the whole `extractAST` function. Update the file header comment (the `generate` seam is now `async ({ tools, user }) => text`; the default model is FunctionGemma-270M) and set:

```js
export const DEFAULT_NL_MODEL = "onnx-community/functiongemma-270m-it-ONNX"
```

Update the default export (transformersGenerator still exists until Task 4):

```js
export default { DEFAULT_NL_MODEL, filterTool, parseCall, llmNLProvider, transformersGenerator }
```

NOTE: `transformersGenerator` still returns `({ system, user })` text — it is dead wrong for the new seam but still referenced by `server.js`; it dies in Task 4. Do not patch it here.

- [ ] **Step 4: Run test to verify it passes**

Run: `node test.js nl`
Expected: PASS (NL-12 new form, NL-12a, NL-12b all green).

- [ ] **Step 5: Commit**

```bash
git add src/core/NL/llm.js test/nl/nl.test.js
git commit -m "NL tier 4: the generate seam carries tools, not prose — prompt-text halves deleted"
```

---

### Task 4: `functionGemmaGenerator` + server rewire + gated real-model test

**Files:**
- Modify: `src/core/NL/llm.js` (replace `transformersGenerator` with `functionGemmaGenerator`; final default export)
- Modify: `src/core/HTTP/server.js:139-140` (import + call the new name)
- Create: `test/nl/functiongemma.test.js` (gated conformance, embeddinggemma.test.js pattern)
- Modify: `test.js` (register the new test file next to the nl import)

**Interfaces:**
- Consumes: `llmNLProvider`, `filterTool`, `parseCall` (Tasks 1–3); `@huggingface/transformers` `AutoTokenizer`/`AutoModelForCausalLM`.
- Produces: `functionGemmaGenerator({ model = DEFAULT_NL_MODEL, root, onProgress })` → `async ({ tools, user }) => text` (decoded WITH special tokens — the call markers are the format). `server.js` builds the tier-4 provider from it.

- [ ] **Step 1: Replace `transformersGenerator` with `functionGemmaGenerator`** in `src/core/NL/llm.js`:

```js
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
```

- [ ] **Step 2: Rewire `src/core/HTTP/server.js:139-140`**:

```js
                    const { llmNLProvider, functionGemmaGenerator } = await import("../NL/llm.js")
                    llm = llmNLProvider({ generate: await functionGemmaGenerator({ model: nlModel, root }) })
```

- [ ] **Step 3: Create `test/nl/functiongemma.test.js`** — gated like embeddinggemma.test.js: probe once, skip when the library/model is absent. Plumbing conformance, not zero-shot quality bets:

```js
/**
 * FunctionGemma conformance (FG-*) — the DEFAULT NL model, run only where
 * the instance library + weights load (test/.engines, HF cache). Pins the
 * PLUMBING: tools reach the template, the model emits call syntax, and the
 * choke point holds. Zero-shot ACCURACY is not asserted — the tier chain
 * tolerates a wrong composition; a widened access it cannot cause (NL-04).
 */

import { fileURLToPath } from "url"
import Test, { assert } from "../../src/core/Test.js"
import { llmNLProvider, functionGemmaGenerator, filterTool, parseCall } from "../../src/core/NL/llm.js"
import { translate } from "../../src/core/NL.js"
import { schema, field } from "../conformance/model/_helpers.js"

const ENGINES_ROOT = fileURLToPath(new URL("../.engines", import.meta.url))

const TASK = schema({
    name: "task",
    fields: [
        field("title", "text", { required: true, label: { en: "Title", vi: "Tiêu đề" } }),
        field("done", "boolean", { label: { en: "Done", vi: "Xong" } }),
        field("priority", "select", { options: ["low", "medium", "high"] })
    ]
})

let generate = null
try {
    generate = await functionGemmaGenerator({ root: ENGINES_ROOT })
} catch {
    generate = null
}

if (!generate) {
    Test.describe("FunctionGemma — default NL model (FG, model absent)", () => {
        Test.it("FG-00 skipped — npm --prefix test/.engines install @huggingface/transformers to run", () => {}, { browser: true })
    })
} else {
    Test.describe("FunctionGemma — default NL model (FG)", () => {
        Test.it("FG-01 tools reach the template and the model answers in call syntax", async () => {
            const text = await generate({ tools: [filterTool(TASK)], user: "high priority tasks" })
            assert.truthy(text.includes("<start_function_call>"), `call marker present in: ${text.slice(0, 200)}`)
        })

        Test.it("FG-02 the full tier: whatever the model composes is parsed strictly and schema-validated", async () => {
            const provider = llmNLProvider({ generate })
            // strict plumbing: either a translate()-valid document comes back,
            // or the tier fails loudly with an E_NL_* error — never silence,
            // never an unvalidated document
            try {
                const document = await translate("việc ưu tiên cao", TASK, provider)
                assert.equal(document.astVersion, 1)
            } catch (error) {
                assert.truthy(/^E_NL_/.test(error.message), `tier failures are E_NL_*: ${error.message}`)
            }
        })
    })
}
```

- [ ] **Step 4: Register the suite in `test.js`** — next to the existing nl import line (find `import "./test/nl/nl.test.js"`), add:

```js
import "./test/nl/functiongemma.test.js"
```

- [ ] **Step 5: Run the nl suites**

Run: `node test.js nl`
Expected: NL-* PASS; FG-00 skipped (or FG-01/02 pass where test/.engines has the library — first run downloads weights).

- [ ] **Step 6: Run the full suite**

Run: `node test.js`
Expected: all green, same skip count as main (+1 FG skip where weights absent).

- [ ] **Step 7: Commit**

```bash
git add src/core/NL/llm.js src/core/HTTP/server.js test/nl/functiongemma.test.js test.js
git commit -m "NL tier 4: FunctionGemma-270M ONNX generator — tools through the chat template"
```

---

### Task 5: instance config + end-to-end verification

**Files:**
- Modify: `C:/Users/x/Projects/my-app/nexus.config.json` (outside the repo — no commit)

**Interfaces:**
- Consumes: the dev server tier chain (`config.semantic.nlModel` → `functionGemmaGenerator`).
- Produces: a verified live instance; evidence for the final report.

- [ ] **Step 1: Point the instance at FunctionGemma** — in `my-app/nexus.config.json` set:

```json
"nlModel": "onnx-community/functiongemma-270m-it-ONNX"
```

- [ ] **Step 2: Restart the dev server** (kill any running one first):

```bash
cd C:/Users/x/Projects/my-app && node C:/Users/x/Projects/nexus/bin/nexus.js dev
```

Expected banner: `embed  semantic · onnx-community/embeddinggemma-300m-ONNX`.

- [ ] **Step 3: Drive the LLM tier end-to-end** — a COMPOUND ask routes to the model (first call downloads ~300 MB of weights; allow minutes):

```bash
curl -s -X POST http://localhost:8080/api/v1/task/ask -H "content-type: application/json" -H "x-nexus-user: dev" -d "{\"query\":\"việc ưu tiên cao hoặc thấp mà chưa xong\"}"
```

Expected: `{"ok":true,…}` with a `filter` composing priority + done (model quality permitting), or a clean fallback to the intent tier — NEVER a 500. Also re-run the two regression probes: `POST /api/v1/task/search` with `hệ điều hành` still returns the Windows task; the Studio search page still renders it.

- [ ] **Step 4: Verify the suite once more and report** — `node test.js` all green; report model behavior honestly (including if the 270M zero-shot composition is weak — that feeds the fine-tuning note in the spec).

---

## Self-Review (done)

- **Spec coverage:** decision 1 (replace) → Tasks 3–4 delete `schemaPrompt`/`extractAST`/`transformersGenerator`; decision 2 (recursive shape) → Task 1 NODE schema; model swap → Tasks 3 (constant) + 4 (generator) + 5 (instance config); ripples → Task 4 server.js + tests; error handling unchanged → NL-12b strictness tests.
- **Placeholders:** none — every step carries complete code/commands.
- **Type consistency:** the seam is `{ tools, user }` in Tasks 3 and 4; `parseCall` names match between Tasks 2–4; `DEFAULT_NL_MODEL` updated once (Task 3) and consumed by Task 4.
