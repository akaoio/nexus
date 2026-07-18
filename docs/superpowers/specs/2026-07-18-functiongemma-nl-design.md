# NL→AST tier 4: FunctionGemma ONNX with schema-as-schema tool calling

**Date:** 2026-07-18 · **Status:** approved

## Problem

The LLM NL→AST provider (`src/core/NL/llm.js`) passes the entity schema to the
model by rendering it into a **text system prompt** (`schemaPrompt`), and runs
Qwen2.5-0.5B/1.5B-Instruct — too heavy for edge devices, and the schema is not
machine-readable to the model. The correct contract is **schema into schema**:
the entity's fields become a structured function declaration passed through the
chat template's `tools` parameter, and the model emits a structured function
call, not free-form JSON.

## Decisions (made with the author)

1. **Replace entirely** — FunctionGemma-270M ONNX is the only path. The
   prompt-text path (`schemaPrompt`, `extractAST`, `transformersGenerator`)
   is deleted. No shims, no fallback second code path (akao rule).
2. **Recursive tool shape** — the `filter` parameter carries the full
   recursive node grammar (leaf `{field, operator, value}` | group
   `{op, children[]}`), matching the AST exactly. Accepted risk: a 270M
   model may mis-nest; `translate()` validation + the tier fallbacks catch it.

## Design

### Model

- `DEFAULT_NL_MODEL = "onnx-community/functiongemma-270m-it-ONNX"` (270M,
  Gemma 3 base, trained specifically for function calling; ONNX for
  transformers.js in Node and browser; ~4× smaller than Qwen2.5-0.5B).

### `src/core/NL/llm.js` — rewritten, same seam philosophy

Three units, each pure or a seam:

1. **`filterTool(schema)`** (pure — replaces `schemaPrompt`)
   Builds the function declaration from the Model Schema:
   ```
   { type: "function", function: {
       name: "filter_records",
       description: "Filter <entity> records. filter=null means everything.",
       parameters: { type: "object", properties: { filter: NODE }, required: ["filter"] } } }
   ```
   `NODE` is an object schema whose description states the leaf/group
   recursion; `field` is an **enum** of the entity's field names + system
   fields (id, owner, created_at, updated_at); `operator` is an enum of the
   closed operator list (eq ne gt gte lt lte like nlike in nin between
   isnull notnull); field types, select options, labels, and `$NOW` date
   forms go into description strings. `children` items reference the same
   shape by description (FunctionGemma's template serializes the schema
   flat; `$defs` is not rendered).

2. **`parseCall(text)`** (pure — replaces `extractAST`)
   Parses FunctionGemma output:
   `<start_function_call>call:filter_records{filter:…}<end_function_call>`
   with `<escape>`-delimited strings, into `{ astVersion: 1, root }`.
   `filter:null` → root null. No function call, wrong function name,
   unbalanced/unparseable args → `E_NL_LLM`. Adds no trust: output still
   goes through `translate()` (format + vocabulary validation) and the Data
   Plane's permission injection (NL-02/NL-04 unchanged).

3. **`functionGemmaGenerator({ model, root, onProgress })`** (seam —
   replaces `transformersGenerator`)
   Loads `AutoTokenizer` + `AutoModelForCausalLM` from the INSTANCE's
   node_modules (N2 rule, same resolution as today). Returns
   `async ({ tools, user }) => text`:
   - messages: one `developer` turn ("You are a model that can do function
     calling with the following functions") + the `user` query
   - `tokenizer.apply_chat_template(messages, { tools, add_generation_prompt: true, return_dict: true })`
   - `model.generate({ …inputs, max_new_tokens: 256, do_sample: false })`
   - decode the new tokens with `skip_special_tokens: false` (the call
     markers ARE the output format)
   The `pipeline()` API is not used — it cannot pass `tools`.

4. **`llmNLProvider({ generate })`** (unchanged role)
   `generate({ tools: [filterTool(schema)], user: query })` → `parseCall`.

### Ripples

- `src/core/HTTP/server.js` — import `functionGemmaGenerator` instead of
  `transformersGenerator`; everything else (lazy load, tier routing,
  COMPOUND gate, fallback to intents) unchanged.
- `test/nl/nl.test.js` NL-12 — rewritten: `filterTool` declares every
  non-table field + enums; `parseCall` handles escape-strings, arrays,
  nested groups, null, garbage → `E_NL_LLM`; provider round-trip with a
  stub generate. A real-model conformance test follows the
  embeddinggemma.test.js pattern (probe, skip when absent).
- `my-app/nexus.config.json` — `semantic.nlModel` →
  `"onnx-community/functiongemma-270m-it-ONNX"` in the same change (the
  old value would send text prompts to a function-calling model).

### Error handling

Unchanged by design: any model/parse failure is `E_NL_LLM`; the server's
tier chain already catches it and falls back to intent retrieval; an AST
with unknown fields dies in `translate()` (`E_NL_FIELD`/`E_NL_AST`).

### Out of scope

- Fine-tuning FunctionGemma on the filter grammar (Google's intended path
  for quality — noted as future work if zero-shot accuracy disappoints).
- Few-shot call examples in the developer turn (needs template support for
  assistant function-call turns; revisit with fine-tuning).
- Browser Studio integration of the NL model (server-side tier only today).

## References

- https://huggingface.co/onnx-community/functiongemma-270m-it-ONNX (usage
  sample: apply_chat_template + tools, output format)
- https://blog.google/innovation-and-ai/technology/developers-tools/functiongemma/
