/**
 * Saved views conformance (VIEW-*) — ARCHITECTURE.md §7. A saved view is
 * ordinary data: it round-trips through the same Data Plane as any entity
 * (permissioned, ownable), and `applyView` reconstructs the exact list a user
 * saved. Closes the <nx-list-view> "saved views deferred to storage" note.
 */

import Test, { assert } from "../../src/core/Test.js"
import { applyView, packView, unpackView, viewSchema, saveView, updateView, listViews, getView, removeView } from "../../src/studio/views.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { doc, leaf } from "../conformance/ast/_helpers.js"

const VIEW = viewSchema()

async function makePlane() {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const b of tableDDL(kysely, VIEW)) db.exec(b.compile().sql)
    const executor = { run: (s, p = []) => void db.prepare(s).run(...p), all: (s, p = []) => db.prepare(s).all(...p) }
    return new DataPlane({ executor, schemas: [VIEW], dialect: "sqlite" })
}
const ctxFor = (user, ifOwner = false) => ({
    user,
    roles: [],
    policies: [{ entity: "nexus_view", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner }],
    shares: []
})

const ROWS = [
    { id: "a", tier: "gold", score: 10, name: "Ann" },
    { id: "b", tier: "silver", score: 5, name: "Bo" },
    { id: "c", tier: "gold", score: null, name: "Cy" }
]

Test.describe("Saved views (VIEW)", () => {
    Test.it("VIEW-01 applyView reconstructs a list: filter → sort → column projection", () => {
        const view = { filter: doc(leaf("tier", "eq", "gold")), sort: { field: "score", dir: "desc" }, columns: ["id", "score"] }
        const { rows } = applyView(ROWS, view)
        // gold rows only, score DESC with nulls LAST, projected to id+score
        assert.deepEqual(rows, [{ id: "a", score: 10 }, { id: "c", score: null }])
    })

    Test.it("VIEW-02 applyView groups when a group field is set", () => {
        const { groups } = applyView(ROWS, { group: "tier" })
        assert.deepEqual([...groups.keys()].sort(), ["gold", "silver"])
        assert.equal(groups.get("gold").length, 2)
    })

    Test.it("VIEW-03 pack/unpack round-trips the view shape through a stored row", () => {
        const view = { name: "My gold", entity: "customer", filter: doc(leaf("tier", "eq", "gold")), sort: { field: "score", dir: "asc" }, columns: ["id"] }
        const packed = packView(view)
        assert.equal(packed.name, "My gold")
        assert.equal(packed.entity, "customer")
        const back = unpackView({ id: "V1", owner: "u1", ...packed })
        assert.deepEqual(back.filter, view.filter)
        assert.deepEqual(back.sort, view.sort)
        assert.deepEqual(back.columns, ["id"])
    })

    Test.it("VIEW-04 a view persists through the Data Plane: save → get → list by entity", async () => {
        const plane = await makePlane()
        const ctx = ctxFor("u1")
        const saved = await saveView(plane, { name: "Open high", entity: "task", filter: doc(leaf("done", "eq", false)), sort: { field: "points", dir: "desc" } }, ctx)
        assert.truthy(saved.id)
        const loaded = await getView(plane, saved.id, ctx)
        assert.equal(loaded.name, "Open high")
        assert.deepEqual(loaded.filter, doc(leaf("done", "eq", false)))
        // a view for a DIFFERENT entity is not returned
        await saveView(plane, { name: "Other", entity: "invoice", filter: null }, ctx)
        const taskViews = await listViews(plane, "task", ctx)
        assert.equal(taskViews.length, 1)
        assert.equal(taskViews[0].name, "Open high")
    })

    Test.it("VIEW-05 update overwrites in place; remove deletes", async () => {
        const plane = await makePlane()
        const ctx = ctxFor("u1")
        const saved = await saveView(plane, { name: "v1", entity: "task", sort: { field: "id", dir: "asc" } }, ctx)
        const updated = await updateView(plane, saved.id, { name: "v1-renamed", entity: "task", sort: { field: "id", dir: "desc" } }, ctx)
        assert.equal(updated.name, "v1-renamed")
        assert.equal((await getView(plane, saved.id, ctx)).sort.dir, "desc")
        await removeView(plane, saved.id, ctx)
        assert.equal(await getView(plane, saved.id, ctx), null)
    })

    Test.it("VIEW-06 views are permission-scoped: a user only sees their own (ifOwner)", async () => {
        const plane = await makePlane()
        await saveView(plane, { name: "u1 view", entity: "task", filter: null }, ctxFor("u1", true))
        await saveView(plane, { name: "u2 view", entity: "task", filter: null }, ctxFor("u2", true))
        const u1Views = await listViews(plane, "task", ctxFor("u1", true))
        assert.equal(u1Views.length, 1)
        assert.equal(u1Views[0].name, "u1 view")
    })
})
