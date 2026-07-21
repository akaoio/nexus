/**
 * `search()` caps the embedding work it does inside a request (SEM-CAP-*) —
 * issue #9's "`search()` can re-embed up to 1000 rows inline".
 *
 * `#currentVectors` re-embedded every candidate whose stored vector was
 * missing or belonged to a different model, inline, in the request. After a
 * model switch that is up to MAX_LIMIT (1000) rows of synchronous ML work
 * inside one HTTP request.
 *
 * SEM-CAP-02 is what makes the cap honest. A cap alone would rank against a
 * partially-embedded corpus with no path to completion — degrading quietly,
 * forever, which is worse than the unbounded version because nothing ever
 * tells you. The corpus finishes in the background instead.
 *
 * Why background rather than a job: the job thread reaches data through a
 * deliberately narrow 4-op plane RPC (create/update/get/list) that cannot
 * write the embedding tables. Routing this through it would mean widening that
 * seam, and the seam is narrow on purpose (THR-04).
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/core/Test.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { handleTransaction } from "../../src/core/Data/transaction.js"

const NOTE = {
    schemaVersion: 1,
    name: "note",
    label: { en: "Note" },
    fields: [{ name: "title", type: "text", label: { en: "T" } }],
    semantic: { embed: [{ field: "title" }] }
}

const CTX = {
    user: "u1",
    roles: [],
    shares: [],
    policies: [{ entity: "note", actions: ["read", "create", "write", "delete"], rule: null, permlevel: 0, ifOwner: false }]
}

/** An embedder that records how many texts it was asked for, per call. */
function makeEmbedder(name = "m1") {
    const calls = []
    return {
        provider: {
            name,
            version: 1,
            embed: async (texts) => {
                calls.push(texts.length)
                return texts.map(() => [1, 0, 0])
            }
        },
        calls,
        total: () => calls.reduce((a, b) => a + b, 0)
    }
}

function makePlane(embedder, { maxInlineEmbed } = {}) {
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const b of tableDDL(kysely, NOTE)) db.exec(b.compile().sql)
    const run = (sql, params = []) => void db.prepare(sql).run(...params)
    const all = (sql, params = []) => db.prepare(sql).all(...params)
    return new DataPlane({
        executor: { run, all, transaction: handleTransaction(run, all, "BEGIN IMMEDIATE") },
        schemas: [NOTE],
        dialect: "sqlite",
        now: () => "2026-07-21T00:00:00.000Z",
        embedder: embedder.provider,
        maxInlineEmbed
    })
}

const storedCount = (plane) =>
    plane.executor.all(`SELECT COUNT(*) AS n FROM _nexus_embeddings WHERE model = ?`, ["m2@1"])[0].n

Test.describe("Inline embedding is capped (SEM-CAP)", () => {

    Test.it("SEM-CAP-01 a search after a model switch embeds at most the cap inside the request, not the whole candidate set", async () => {
        const first = makeEmbedder("m1")
        const plane = makePlane(first, { maxInlineEmbed: 5 })
        for (let i = 0; i < 30; i++) await plane.create("note", { title: `note ${i}` }, CTX)

        // Switch models: every stored vector now belongs to the wrong model, so
        // all 30 candidates are "missing" from the new model's point of view.
        const second = makeEmbedder("m2")
        plane.embedder = second.provider
        second.calls.length = 0

        await plane.search("note", { query: "note", mode: "vector", k: 5 }, CTX)

        const inlineQueryEncode = 1 // the query itself is one text
        assert.truthy(
            second.total() - inlineQueryEncode <= 5,
            `at most 5 documents may be embedded inside the request, saw ${second.total() - inlineQueryEncode}`
        )
    })

    Test.it("SEM-CAP-02 the rest finishes in the BACKGROUND — the corpus completes instead of degrading quietly forever", async () => {
        const first = makeEmbedder("m1")
        const plane = makePlane(first, { maxInlineEmbed: 5 })
        for (let i = 0; i < 30; i++) await plane.create("note", { title: `note ${i}` }, CTX)

        const second = makeEmbedder("m2")
        plane.embedder = second.provider

        await plane.search("note", { query: "note", mode: "vector", k: 5 }, CTX)
        assert.truthy(storedCount(plane) < 30, "the request itself must not have done all the work")

        await plane.embeddingBackfill // the drain this search scheduled
        assert.equal(storedCount(plane), 30, "and afterwards the whole corpus is embedded under the current model")
    })

    Test.it("SEM-CAP-03 with everything already embedded, a search does no document embedding at all", async () => {
        const embedder = makeEmbedder("m1")
        const plane = makePlane(embedder, { maxInlineEmbed: 5 })
        for (let i = 0; i < 10; i++) await plane.create("note", { title: `note ${i}` }, CTX)

        embedder.calls.length = 0
        await plane.search("note", { query: "note", mode: "vector", k: 5 }, CTX)

        // Only the query is encoded — write-time embedding already covered the
        // documents, so the cap costs a warm corpus nothing.
        assert.equal(embedder.total(), 1, `only the query should be encoded, saw ${embedder.total()}`)
    })
})
