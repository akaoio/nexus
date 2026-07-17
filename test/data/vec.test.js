/**
 * sqlite-vec conformance (VEC-*) — a REAL vector index (the vec0 virtual
 * table, loadable extension) doing REAL KNN, driven end to end with a real
 * ONNX embedding model. Gated on both the extension and the model being
 * installed under test/.engines/; skips otherwise, so the suite stays green.
 *
 *   npm --prefix test/.engines install sqlite-vec @huggingface/transformers
 */

import Test, { assert } from "../../src/kernel/Test.js"
import { createExecutor } from "../../src/data/adapters.js"
import { transformersProvider } from "../../src/semantic/transformers.js"
import { DataPlane } from "../../src/data/DataPlane.js"
import { tableDDL } from "../../src/data/ddl.js"
import { createCompiler } from "../../src/data/kysely.js"
import { schema, field } from "../conformance/model/_helpers.js"

const ENGINES_ROOT = new URL("../.engines", import.meta.url).pathname

let vecOk = false
let embedder = null
try {
    const ex = await createExecutor("sqlite", { root: ENGINES_ROOT, path: ":memory:", vec: true })
    vecOk = ex.vec === true
    await ex.close?.()
    embedder = await transformersProvider({ model: "Xenova/all-MiniLM-L6-v2", root: ENGINES_ROOT })
} catch {
    vecOk = false
}

const NOTE = schema({
    name: "note",
    fields: [field("title", "text", { required: true }), field("tag", "text")],
    semantic: { embed: [{ field: "title" }], template: { en: "{title}" } }
})
const policy = { entity: "note", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false }
const CTX = { user: "u1", roles: [], policies: [policy], shares: [] }

async function makePlane() {
    const ex = await createExecutor("sqlite", { root: ENGINES_ROOT, path: ":memory:", vec: true })
    const kysely = createCompiler("sqlite")
    for (const b of tableDDL(kysely, NOTE)) await ex.run(b.compile().sql)
    return { ex, plane: new DataPlane({ executor: ex, schemas: [NOTE], dialect: "sqlite", embedder }) }
}

if (!vecOk || !embedder) {
    Test.describe("sqlite-vec ANN (VEC, extension/model absent)", () => {
        Test.it("VEC-00 skipped — install sqlite-vec + @huggingface/transformers under test/.engines", () => {}, { browser: true })
    })
} else {
    Test.describe("sqlite-vec ANN (VEC)", () => {
        Test.it("VEC-01 the adapter loads the extension (executor.vec === true)", async () => {
            const ex = await createExecutor("sqlite", { root: ENGINES_ROOT, path: ":memory:", vec: true })
            assert.equal(ex.vec, true)
            assert.equal((await ex.all("SELECT vec_version() AS v"))[0].v.startsWith("v"), true)
            await ex.close?.()
        })

        Test.it("VEC-02 writes populate a real vec0 index; search retrieves by MEANING via KNN", async () => {
            const { ex, plane } = await makePlane()
            const target = await plane.create("note", { title: "recovering access when you cannot sign in", tag: "public" }, CTX)
            await plane.create("note", { title: "our summer sale on garden furniture", tag: "public" }, CTX)
            await plane.create("note", { title: "a recipe for chocolate chip cookies", tag: "public" }, CTX)

            // the vec0 index actually holds rows
            const count = (await ex.all(`SELECT COUNT(*) AS n FROM "_nexus_vec_note"`))[0].n
            assert.equal(count, 3)

            // query shares no content words with the target, and the two
            // distractors are clearly unrelated — real ANN by meaning
            const hits = await plane.search("note", { query: "I lost my login credentials", mode: "vector" }, CTX)
            assert.equal(hits[0].row.id, target.id, "KNN ranks the semantically nearest note first")
            await ex.close?.()
        })

        Test.it("VEC-03 delete removes the vector from the index", async () => {
            const { ex, plane } = await makePlane()
            const row = await plane.create("note", { title: "temporary note", tag: "public" }, CTX)
            assert.equal((await ex.all(`SELECT COUNT(*) AS n FROM "_nexus_vec_note"`))[0].n, 1)
            await plane.remove("note", row.id, CTX)
            assert.equal((await ex.all(`SELECT COUNT(*) AS n FROM "_nexus_vec_note"`))[0].n, 0)
            await ex.close?.()
        })

        Test.it("VEC-04 SECURITY: ANN ranking stays inside permission — the over-fetch cannot leak", async () => {
            const { ex, plane } = await makePlane()
            await plane.create("note", { title: "classified breach response runbook", tag: "private" }, CTX)
            const pub = await plane.create("note", { title: "public incident FAQ for customers", tag: "public" }, CTX)
            const scoped = { ...CTX, policies: [{ ...policy, rule: { astVersion: 1, root: { field: "tag", operator: "eq", value: "public" } } }] }
            const hits = await plane.search("note", { query: "security incident handling", mode: "vector" }, scoped)
            assert.truthy(hits.length >= 1)
            assert.truthy(hits.every((h) => h.row.id === pub.id), "the private row never surfaces through the ANN path")
            await ex.close?.()
        })
    })
}
