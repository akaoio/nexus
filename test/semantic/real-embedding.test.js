/**
 * Real embedding conformance (REM-*) — semantic search with a REAL ONNX
 * model (transformers.js), not the deterministic lexical fallback. Proves
 * end to end what hashProvider cannot: a query that shares NO keywords with
 * the target still retrieves it by MEANING.
 *
 * transformers.js is the instance's dependency (installed under
 * test/.engines/). The clauses skip when it is absent, so the suite stays
 * green everywhere while running the real model where it exists:
 *
 *   npm --prefix test/.engines install @huggingface/transformers
 */

import { fileURLToPath } from "url"
import Test, { assert } from "../../src/core/Test.js"
import { transformersProvider } from "../../src/core/Semantic/transformers.js"
import { embeddingNLProvider, translate } from "../../src/core/NL.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import * as AST from "../../src/core/AST.js"
import { schema, field } from "../conformance/model/_helpers.js"
import { doc, leaf } from "../conformance/ast/_helpers.js"

const ENGINES_ROOT = fileURLToPath(new URL("../.engines", import.meta.url))

// Probe once at load: is the real model available? (Downloads on first run,
// cached thereafter under ~/.cache/huggingface.)
let embedder = null
try {
    embedder = await transformersProvider({ model: "Xenova/all-MiniLM-L6-v2", root: ENGINES_ROOT })
} catch {
    embedder = null
}

const NOTE = schema({
    name: "note",
    fields: [field("title", "text", { required: true }), field("body", "text")],
    semantic: { embed: [{ field: "title", weight: 2 }, { field: "body" }], template: { en: "{title}. {body}" } }
})
const policy = { entity: "note", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false }
const CTX = { user: "u1", roles: [], policies: [policy], shares: [] }

if (!embedder) {
    Test.describe("Real embedding — transformers.js (REM, library absent)", () => {
        Test.it("REM-00 skipped — npm --prefix test/.engines install @huggingface/transformers to run", () => {}, { browser: true })
    })
} else {
    Test.describe("Real embedding — transformers.js (REM)", () => {
        Test.it("REM-01 the provider exposes a real model with real dimensions", () => {
            assert.truthy(embedder.name.includes("MiniLM"))
            assert.inRange(embedder.dims, 128, 4096)
        })

        Test.it("REM-02 SEMANTIC: synonyms with no shared words land close; unrelated text does not", async () => {
            const [q, syn, far] = await embedder.embed([
                "how do I cancel my subscription",
                "steps to end my membership plan",
                "the weather in tokyo is sunny"
            ])
            const cos = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0)
            assert.truthy(cos(q, syn) > 0.35, `synonym similarity ${cos(q, syn).toFixed(3)} must be high`)
            assert.truthy(cos(q, syn) - cos(q, far) > 0.3, "meaning beats surface overlap")
        })

        Test.it("REM-03 E2E: vector search through the Data Plane retrieves by MEANING, not keywords", async () => {
            const { DatabaseSync } = await import("node:sqlite")
            const db = new DatabaseSync(":memory:")
            const kysely = createCompiler("sqlite")
            for (const b of tableDDL(kysely, NOTE)) db.exec(b.compile().sql)
            const executor = { run: (s, p = []) => void db.prepare(s).run(...p), all: (s, p = []) => db.prepare(s).all(...p) }
            const plane = new DataPlane({ executor, schemas: [NOTE], dialect: "sqlite", embedder })

            await plane.create("note", { title: "Refund policy", body: "how to get your money back after a purchase" }, CTX)
            const target = await plane.create("note", { title: "Cancelling your plan", body: "steps to terminate a recurring membership" }, CTX)
            await plane.create("note", { title: "Office hours", body: "the shop opens at nine in the morning" }, CTX)

            // Query shares NO content words with the target ("end subscription")
            const hits = await plane.search("note", { query: "how do I end my subscription", mode: "vector" }, CTX)
            assert.truthy(hits.length >= 1)
            assert.equal(hits[0].row.id, target.id, "the semantically-nearest note ranks first")
        })

        Test.it("REM-05 REAL NL→AST by embedding retrieval: a synonym-phrased ask hits the right intent", async () => {
            const TASK = schema({
                name: "task",
                fields: [field("title", "text"), field("done", "boolean"), field("priority", "select", { options: ["low", "high"] })]
            })
            const provider = embeddingNLProvider({
                embedder,
                examples: [
                    { phrase: "show me open tasks that are not finished", ast: doc(leaf("done", "eq", false)) },
                    { phrase: "urgent high priority items", ast: doc(leaf("priority", "eq", "high")) }
                ]
            })
            // "which work is still pending" — no keyword overlap with "open/not finished"
            const document = await translate("which work is still pending", TASK, provider)
            assert.deepEqual(document.root, { field: "done", operator: "eq", value: false })
            // a clearly different intent routes to the other example
            const urgent = await translate("critical things I must do right away", TASK, provider)
            assert.deepEqual(urgent.root, { field: "priority", operator: "eq", value: "high" })
            // gibberish matches nothing → no guess
            await Test.assert.rejects(translate("banana helicopter velvet", TASK, provider), "E_NL_NOMATCH")
        })

        Test.it("REM-04 SECURITY holds with the real model: ranking stays inside permission", async () => {
            const { DatabaseSync } = await import("node:sqlite")
            const db = new DatabaseSync(":memory:")
            const kysely = createCompiler("sqlite")
            const TAGGED = schema({
                name: "note",
                fields: [field("title", "text", { required: true }), field("tag", "text")],
                semantic: { embed: [{ field: "title" }], template: { en: "{title}" } }
            })
            for (const b of tableDDL(kysely, TAGGED)) db.exec(b.compile().sql)
            const executor = { run: (s, p = []) => void db.prepare(s).run(...p), all: (s, p = []) => db.prepare(s).all(...p) }
            const plane = new DataPlane({ executor, schemas: [TAGGED], dialect: "sqlite", embedder })
            await plane.create("note", { title: "secret cancellation flow", tag: "private" }, CTX)
            const pub = await plane.create("note", { title: "public cancellation help", tag: "public" }, CTX)
            const scoped = { ...CTX, policies: [{ ...policy, rule: { astVersion: 1, root: { field: "tag", operator: "eq", value: "public" } } }] }
            const hits = await plane.search("note", { query: "end my subscription", mode: "vector" }, scoped)
            assert.truthy(hits.every((h) => h.row.id === pub.id), "the private note never surfaces, real model or not")
        })
    })
}
