/**
 * Semantic conformance — §4.6 core (SEM-*).
 * Serialization is data-declared, the dev provider is deterministic, RRF is
 * the exact Cormack formula, and DataPlane.search ranks INSIDE permission —
 * all pinned on the real engine. nx-search rides the browser run.
 */

import Test, { assert } from "../../src/core/Test.js"
import { serializeRow, hashProvider, cosine, textScore, rrf } from "../../src/core/Semantic.js"
import { NxSearch } from "../../src/studio/components/search/index.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { doc, leaf } from "../conformance/ast/_helpers.js"
import { schema, field } from "../conformance/model/_helpers.js"

const NOTE = schema({
    name: "note",
    fields: [field("title", "text", { required: true }), field("body", "text"), field("tag", "text")],
    semantic: {
        embed: [{ field: "title", weight: 2 }, { field: "body" }],
        template: { en: "Note {title}: {body}", vi: "Ghi chú {title}: {body}" },
        reindex: "on_update"
    }
})

const policy = { entity: "note", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false }
const CTX = { user: "u1", roles: [], policies: [policy], shares: [] }

async function makeExecutor() {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const builder of tableDDL(kysely, NOTE)) db.exec(builder.compile().sql)
    return {
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: (sql, params = []) => db.prepare(sql).all(...params)
    }
}

async function makePlane(embedder = hashProvider(128), executor = null) {
    executor = executor ?? (await makeExecutor())
    return new DataPlane({ executor, schemas: [NOTE], dialect: "sqlite", embedder })
}

Test.describe("Semantic — core (SEM-*)", () => {
    Test.it("SEM-01 serializeRow follows the schema's semantic block: template, locale, weights", () => {
        const row = { title: "alpha", body: "beta gamma" }
        const en = serializeRow(NOTE, row)
        assert.truthy(en.startsWith("Note alpha: beta gamma"))
        assert.equal(en.split("\n").filter((l) => l === "alpha").length, 2, "weight 2 repeats the title")
        assert.truthy(serializeRow(NOTE, row, "vi").startsWith("Ghi chú alpha"))
        assert.truthy(serializeRow(NOTE, { title: "x", body: null }).includes("Note x: "), "nulls render empty")
        const bare = schema({ name: "n", fields: [field("a", "text")] })
        assert.equal(serializeRow(bare, { a: "fallback" }), "fallback", "no semantic block → text fields")
    })

    Test.it("SEM-02 the dev provider is deterministic and directionally sane", async () => {
        const provider = hashProvider(128)
        const [a1] = await provider.embed(["ship the framework"])
        const [a2] = await provider.embed(["ship the framework"])
        assert.deepEqual(a1, a2)
        const [b] = await provider.embed(["ship the framework today"])
        const [c] = await provider.embed(["completely unrelated words"])
        assert.truthy(cosine(a1, b) > cosine(a1, c), "overlap beats disjoint")
        assert.inRange(cosine(a1, a1), 0.999, 1.001)
    })

    Test.it("SEM-03 rrf is the exact Cormack formula, rank-only, deterministic ties", () => {
        const expected = (ranks) => ranks.reduce((s, r) => s + 1 / (60 + r), 0)
        const fused = rrf([["a", "b", "c"], ["b"]])
        assert.equal(fused[0].id, "b") // 1/62 + 1/61 beats a's 1/61
        assert.inRange(fused[0].score, expected([2, 1]) - 1e-12, expected([2, 1]) + 1e-12)
        assert.equal(fused[1].id, "a")
        assert.inRange(fused[1].score, expected([1]) - 1e-12, expected([1]) + 1e-12)
        assert.equal(fused[2].id, "c")
        // exact ties break deterministically by id
        const tied = rrf([["x", "y"], ["y", "x"]])
        assert.equal(tied[0].id, "x")
    })

    Test.it("SEM-04 search on the real engine: text, vector and hybrid modes rank sensibly", async () => {
        const plane = await makePlane()
        await plane.create("note", { title: "kysely vendoring", body: "pin the version, verify integrity" }, CTX)
        const target = await plane.create("note", { title: "query builder", body: "recursive AST editor for filters" }, CTX)
        await plane.create("note", { title: "grocery list", body: "rice, fish sauce, coffee" }, CTX)

        for (const mode of ["text", "vector", "hybrid"]) {
            const hits = await plane.search("note", { query: "recursive query editor", mode }, CTX)
            assert.truthy(hits.length >= 1, mode)
            assert.equal(hits[0].row.id, target.id, `${mode} ranks the right note first`)
        }
        assert.deepEqual(await plane.search("note", { query: "" }, CTX), [])
        await Test.assert.rejects(plane.search("note", { query: "x", mode: "psychic" }, CTX), "E_MODE")
    })

    Test.it("SEM-05 embeddings ride the row lifecycle: update re-ranks, delete disappears", async () => {
        const plane = await makePlane()
        const row = await plane.create("note", { title: "original topic", body: "quarterly report numbers" }, CTX)
        // a distractor keeps the corpus honest — before the update it out-ranks
        const distractor = await plane.create("note", { title: "penguins", body: "antarctic penguins colony" }, CTX)
        const before = await plane.search("note", { query: "penguins antarctic", mode: "vector" }, CTX)
        assert.equal(before[0].row.id, distractor.id, "the penguin note ranks first, not the report")
        await plane.update("note", row.id, { title: "penguins", body: "antarctic penguins everywhere" }, CTX)
        const after = await plane.search("note", { query: "penguins antarctic", mode: "vector" }, CTX)
        assert.truthy(after.some((h) => h.row.id === row.id), "the update re-embedded — now it matches too")
        await plane.remove("note", distractor.id, CTX)
        assert.falsy(
            (await plane.search("note", { query: "penguins", mode: "vector" }, CTX)).some((h) => h.row.id === distractor.id),
            "the deleted row's embedding is gone"
        )
    })

    Test.it("SEM-07 switching the embedding model self-heals: stale vectors are ignored and re-embedded with the current model", async () => {
        // rows written under provider A (128d)…
        const executor = await makeExecutor()
        const planeA = await makePlane(hashProvider(128), executor)
        const target = await planeA.create("note", { title: "query builder", body: "recursive AST editor for filters" }, CTX)
        await planeA.create("note", { title: "grocery list", body: "rice, fish sauce, coffee" }, CTX)
        // …then the site switches to provider B (64d, different name) — same database
        const planeB = await makePlane({ ...hashProvider(64), name: "hash-bow-v2" }, executor)
        const hits = await planeB.search("note", { query: "recursive query editor", mode: "vector" }, CTX)
        assert.truthy(hits.length >= 1, "vector search still works after a model switch")
        assert.equal(hits[0].row.id, target.id, "the right note ranks first — no NaN garbage from mixed dims")
        assert.truthy(hits.every((h) => Number.isFinite(h.score)), "every score is a real number")
        // the store now carries CURRENT-model vectors for the searched rows
        const models = executor.all(`SELECT DISTINCT model FROM _nexus_embeddings WHERE entity = 'note'`).map((r) => r.model)
        assert.deepEqual(models, ["hash-bow-v2@1"], "stale vectors were replaced, not merely skipped")
    })

    Test.it("SEM-08 rows created BEFORE any embedder existed are backfilled on first search", async () => {
        const executor = await makeExecutor()
        const bare = await makePlane(null, executor) // no embedder — nothing indexed at write time
        const target = await bare.create("note", { title: "query builder", body: "recursive AST editor" }, CTX)
        await bare.create("note", { title: "grocery list", body: "rice and coffee" }, CTX)
        const plane = await makePlane(hashProvider(128), executor) // the embedder arrives later
        const hits = await plane.search("note", { query: "recursive query editor", mode: "vector" }, CTX)
        assert.truthy(hits.length >= 1, "previously-unindexed rows are searchable")
        assert.equal(hits[0].row.id, target.id)
    })

    Test.it("SEM-09 a provider-declared relevance floor drops weak vector matches — garbage queries return [] instead of everything", async () => {
        // a fake semantic provider: "penguin" texts → [1,0], others → [0.6,0.8]
        // (cosine 0.6 against a penguin query — related-ish but below the floor)
        const fake = {
            name: "fake-sem", version: 1, dims: 2, floor: 0.9,
            async embed(texts) { return texts.map((t) => (/penguin/i.test(t) ? [1, 0] : [0.6, 0.8])) }
        }
        const plane = await makePlane(fake)
        const hit = await plane.create("note", { title: "penguin colony", body: "antarctic" }, CTX)
        await plane.create("note", { title: "quarterly report", body: "numbers" }, CTX)
        const hits = await plane.search("note", { query: "penguin", mode: "vector" }, CTX)
        assert.deepEqual(hits.map((h) => h.row.id), [hit.id], "only the above-floor match surfaces")
        // hybrid: the below-floor row must not ride in through the vector list
        const hybrid = await plane.search("note", { query: "penguin", mode: "hybrid" }, CTX)
        assert.truthy(hybrid.every((h) => h.row.id === hit.id), "no below-floor garbage in hybrid either")
    })

    Test.it("SEM-06 SECURITY: ranking happens INSIDE permission — no row a query could not see surfaces", async () => {
        const plane = await makePlane()
        await plane.create("note", { title: "secret penguins", body: "classified", tag: "private" }, CTX)
        const visible = await plane.create("note", { title: "public penguins", body: "open", tag: "public" }, CTX)
        const scoped = { ...CTX, policies: [{ ...policy, rule: doc(leaf("tag", "eq", "public")) }] }
        const hits = await plane.search("note", { query: "penguins" }, scoped)
        assert.truthy(hits.length >= 1)
        assert.truthy(hits.every((h) => h.row.id === visible.id), "the secret row never surfaces, any mode, any score")
    })
})

Test.describe("Semantic — <nx-search> (SEM, browser)", () => {
    Test.it("SEM-10 nx-search groups injected results per entity and shows scores", async () => {
        const search = document.createElement("nx-search")
        search.schemas = [NOTE]
        search.searcher = async ({ entity, query }) =>
            query === "hit" ? [{ score: 0.5, row: { id: "1", title: "found note" } }] : []
        document.body.appendChild(search)
        search.shadowRoot.querySelector(".query").value = "hit"
        await search.run()
        const text = search.shadowRoot.querySelector(".results").textContent
        assert.truthy(text.includes("note (1)"))
        assert.truthy(text.includes("found note"))
        assert.truthy(text.includes("0.500"))
        search.shadowRoot.querySelector(".query").value = "miss"
        await search.run()
        assert.truthy(search.shadowRoot.querySelector(".results").textContent.includes("no matches"))
        search.remove()
    })
}, { browser: true })
