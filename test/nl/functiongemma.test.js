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
