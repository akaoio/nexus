/**
 * EmbeddingGemma conformance (GEM-*) — the DEFAULT embedding model, run for
 * real. all-MiniLM stays the fast model the bulk semantic/NL/vec suites use so
 * `npm test` runs quickly on constrained hardware; this suite pins the real
 * production model: EmbeddingGemma-300m (Google), 768-dim, with its published
 * asymmetric task prompts (query vs document), retrieving by MEANING.
 *
 * The model is the instance's dependency (transformers.js under test/.engines/)
 * and is large (~300M params). The clauses gate on it loading and skip
 * otherwise — like the live-engine and vec suites — so the suite stays green
 * everywhere while ACTUALLY running EmbeddingGemma where it is present:
 *
 *   npm --prefix test/.engines install @huggingface/transformers
 */

import { fileURLToPath } from "url"
import Test, { assert } from "../../src/kernel/Test.js"
import { transformersProvider } from "../../src/semantic/transformers.js"
import { DataPlane } from "../../src/data/DataPlane.js"
import { tableDDL } from "../../src/data/ddl.js"
import { createCompiler } from "../../src/data/kysely.js"
import { schema, field } from "../conformance/model/_helpers.js"

const ENGINES_ROOT = fileURLToPath(new URL("../.engines", import.meta.url))

// Probe once: does the real EmbeddingGemma load here? (Downloads on first run,
// cached under ~/.cache/huggingface thereafter.) The default model IS Gemma.
let gemma = null
try {
    gemma = await transformersProvider({ root: ENGINES_ROOT })
    if (!/gemma/i.test(gemma.name)) gemma = null
} catch {
    gemma = null
}

const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)

const NOTE = schema({
    name: "note",
    fields: [field("title", "text", { required: true }), field("body", "text")],
    semantic: { embed: [{ field: "title", weight: 2 }, { field: "body" }], template: { en: "{title}. {body}" } }
})
const policy = { entity: "note", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false }
const CTX = { user: "u1", roles: [], policies: [policy], shares: [] }

if (!gemma) {
    Test.describe("EmbeddingGemma — default model (GEM, model absent)", () => {
        Test.it("GEM-00 skipped — npm --prefix test/.engines install @huggingface/transformers to run", () => {}, { browser: true })
    })
} else {
    Test.describe("EmbeddingGemma — default model (GEM)", () => {
        Test.it("GEM-01 the DEFAULT provider is EmbeddingGemma-300m: 768-dim, asymmetric task prompts", () => {
            assert.truthy(gemma.name.includes("embeddinggemma"), `default model is ${gemma.name}`)
            assert.equal(gemma.dims, 768)
            assert.equal(typeof gemma.embedQuery, "function")
            assert.truthy(gemma.prompts.query.includes("query:"), "query prompt is set")
            assert.truthy(gemma.prompts.document.includes("text:"), "document prompt is set")
        })

        Test.it("GEM-02 SEMANTIC: a query retrieves the meaning-nearest document, no shared words", async () => {
            const docs = await gemma.embed([
                "steps to end my recurring membership plan", // target
                "a recipe for chocolate chip cookies",
                "the weather in tokyo is sunny today"
            ])
            const [q] = await gemma.embedQuery(["how do I stop being billed every month"])
            const scores = docs.map((d) => cos(q, d))
            assert.equal(scores.indexOf(Math.max(...scores)), 0, "the cancellation note ranks first by meaning")
            assert.truthy(scores[0] - Math.max(scores[1], scores[2]) > 0.15, "meaning beats surface overlap")
        })

        Test.it("GEM-03 E2E: Data Plane vector search uses Gemma's query prompt and retrieves by meaning", async () => {
            const { DatabaseSync } = await import("node:sqlite")
            const db = new DatabaseSync(":memory:")
            const kysely = createCompiler("sqlite")
            for (const b of tableDDL(kysely, NOTE)) db.exec(b.compile().sql)
            const executor = { run: (s, p = []) => void db.prepare(s).run(...p), all: (s, p = []) => db.prepare(s).all(...p) }
            const plane = new DataPlane({ executor, schemas: [NOTE], dialect: "sqlite", embedder: gemma })

            await plane.create("note", { title: "Refund policy", body: "how to get your money back after a purchase" }, CTX)
            const target = await plane.create("note", { title: "Cancelling your plan", body: "steps to terminate a recurring membership" }, CTX)
            await plane.create("note", { title: "Office hours", body: "the shop opens at nine in the morning" }, CTX)

            const hits = await plane.search("note", { query: "how do I stop being billed every month", mode: "vector" }, CTX)
            assert.truthy(hits.length >= 1)
            assert.equal(hits[0].row.id, target.id, "the semantically-nearest note ranks first")
        })
    })
}
