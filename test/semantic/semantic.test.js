/**
 * Semantic conformance — §4.6 core (SEM-*).
 * Serialization is data-declared, the dev provider is deterministic, RRF is
 * the exact Cormack formula, and DataPlane.search ranks INSIDE permission —
 * all pinned on the real engine. nx-search rides the browser run.
 */

import Test, { assert } from "../../src/kernel/Test.js"
import { serializeRow, hashProvider, cosine, textScore, rrf } from "../../src/semantic/semantic.js"
import { NxSearch } from "../../src/studio/search.js"
import { DataPlane } from "../../src/data/DataPlane.js"
import { tableDDL } from "../../src/data/ddl.js"
import { createCompiler } from "../../src/data/kysely.js"
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

async function makePlane() {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const builder of tableDDL(kysely, NOTE)) db.exec(builder.compile().sql)
    const executor = {
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: (sql, params = []) => db.prepare(sql).all(...params)
    }
    return new DataPlane({ executor, schemas: [NOTE], dialect: "sqlite", embedder: hashProvider(128) })
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
