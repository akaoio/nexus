/**
 * Data Plane conformance — CRUD API (DPL-*).
 *
 * The runtime heart, exercised full-stack on a real SQLite engine:
 * Model row-validation + authoritative defaults, Permission (doc/field/row
 * on both images), AST injection into every query, ULID identity, system
 * fields, and the no-existence-leak error shape.
 */

import { DatabaseSync } from "node:sqlite"
import Test, { assert } from "../../src/kernel/Test.js"
import { DataPlane } from "../../src/data/DataPlane.js"
import { ulid } from "../../src/data/ulid.js"
import { tableDDL } from "../../src/data/ddl.js"
import { createCompiler } from "../../src/data/kysely.js"
import { schema, field } from "../conformance/model/_helpers.js"
import { doc, leaf, or } from "../conformance/ast/_helpers.js"

const TASK = schema({
    name: "task",
    fields: [
        field("title", "text", { required: true }),
        field("done", "boolean", { default: false }),
        field("priority", "select", { options: ["low", "medium", "high"], default: "medium" }),
        field("points", "integer"),
        field("salary", "number", { permlevel: 2 })
    ]
})

const CLOCK = "2026-07-16T00:00:00.000Z"

function makePlane({ now } = {}) {
    const db = new DatabaseSync(":memory:")
    const kysely = createCompiler("sqlite")
    for (const builder of tableDDL(kysely, TASK)) db.exec(builder.compile().sql)
    const executor = {
        run: (sql, params = []) => void db.prepare(sql).run(...params),
        all: (sql, params = []) => db.prepare(sql).all(...params)
    }
    const plane = new DataPlane({ executor, schemas: [TASK], dialect: "sqlite", now: now ?? (() => CLOCK) })
    return { plane, db }
}

const policy = (over = {}) => ({ entity: "task", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false, ...over })
const CTX = (over = {}) => ({ user: "u1", roles: [], policies: [policy()], shares: [], ...over })

Test.describe("Data Plane — CRUD API (DPL-*)", () => {
    Test.it("DPL-01 create stamps identity and system fields, applies authoritative defaults, persists", async () => {
        const { plane, db } = makePlane()
        const row = await plane.create("task", { title: "ship it" }, CTX())
        assert.equal(row.id.length, 26)
        assert.equal(row.owner, "u1")
        assert.equal(row.created_at, CLOCK)
        assert.equal(row.updated_at, CLOCK)
        assert.equal(row.done, false) // default, applied by the Data Plane
        assert.equal(row.priority, "medium")
        assert.equal(row.points, null)
        const stored = db.prepare("SELECT * FROM task").get()
        assert.equal(stored.title, "ship it")
        assert.equal(stored.done, 0) // sqlite storage form
    })

    Test.it("DPL-02 create validates the payload against the schema, loudly", async () => {
        const { plane } = makePlane()
        const reject = (data, code) => Test.assert.rejects(plane.create("task", data, CTX()), code)
        await reject({ title: "x", ghost: 1 }, "E_FIELD_UNKNOWN")
        await reject({ title: 42 }, "E_VALUE_TYPE")
        await reject({ title: "x", points: 1.5 }, "E_VALUE_TYPE")
        await reject({ title: "x", priority: "urgent" }, "E_VALUE_OPTION")
        await reject({}, "E_REQUIRED")
        await reject({ title: "x", id: "custom" }, "E_FIELD_SYSTEM")
        await reject({ title: "x", owner: "u9" }, "E_FIELD_SYSTEM")
    })

    Test.it("DPL-03 deny-by-default and post-image row rules gate create", async () => {
        const { plane } = makePlane()
        await Test.assert.rejects(plane.create("task", { title: "x" }, CTX({ policies: [] })), "E_FORBIDDEN")
        const ruled = CTX({ policies: [policy({ rule: doc(leaf("priority", "eq", "high")) })] })
        const ok = await plane.create("task", { title: "x", priority: "high" }, ruled)
        assert.equal(ok.priority, "high")
        await Test.assert.rejects(plane.create("task", { title: "y", priority: "low" }, ruled), "E_FORBIDDEN_ROW")
    })

    Test.it("DPL-04 get returns the normalized row; missing and forbidden are both null", async () => {
        const { plane } = makePlane()
        const created = await plane.create("task", { title: "x", done: true }, CTX())
        const row = await plane.get("task", created.id, CTX())
        assert.equal(row.done, true) // boolean, not 1
        assert.equal(await plane.get("task", ulid(), CTX()), null)
        const scoped = CTX({ policies: [policy({ rule: doc(leaf("priority", "eq", "high")) })] })
        assert.equal(await plane.get("task", created.id, scoped), null) // forbidden ≡ missing
    })

    Test.it("DPL-05 permlevel fields are invisible without the matching-level policy — read and write", async () => {
        const { plane } = makePlane()
        const base = CTX()
        const created = await plane.create("task", { title: "x" }, base)
        const row = await plane.get("task", created.id, base)
        assert.falsy("salary" in row, "level-2 field must not be selected")
        await Test.assert.rejects(plane.update("task", created.id, { salary: 9.5 }, base), "E_FIELD_FORBIDDEN")

        const elevated = CTX({ policies: [policy(), policy({ permlevel: 2 })] })
        await plane.update("task", created.id, { salary: 9.5 }, elevated)
        const visible = await plane.get("task", created.id, elevated)
        assert.equal(visible.salary, 9.5)
    })

    Test.it("DPL-06 list: the caller's filter narrows INSIDE the permission filter — never escapes", async () => {
        const { plane } = makePlane()
        const admin = CTX()
        await plane.create("task", { title: "a", priority: "high", points: 3 }, admin)
        await plane.create("task", { title: "b", priority: "low", points: 8 }, admin)
        await plane.create("task", { title: "c", priority: "high", points: 8 }, admin)

        const all = await plane.list("task", { orderBy: [{ field: "title" }] }, admin)
        assert.deepEqual(all.map((r) => r.title), ["a", "b", "c"])

        const filtered = await plane.list(
            "task",
            { filter: doc(or(leaf("points", "eq", 8), leaf("title", "eq", "a"))), orderBy: [{ field: "title", dir: "desc" }], limit: 2 },
            admin
        )
        assert.deepEqual(filtered.map((r) => r.title), ["c", "b"])

        // Permission narrows to high — the same caller filter cannot reach "b"
        const scoped = CTX({ policies: [policy({ rule: doc(leaf("priority", "eq", "high")) })] })
        const inside = await plane.list("task", { filter: doc(leaf("points", "eq", 8)) }, scoped)
        assert.deepEqual(inside.map((r) => r.title), ["c"])
    })

    Test.it("DPL-07 update patches, bumps updated_at, keeps identity; not-found and forbidden are identical", async () => {
        let current = CLOCK
        const { plane } = makePlane({ now: () => current })
        const created = await plane.create("task", { title: "x" }, CTX())
        current = "2026-07-16T01:00:00.000Z"
        const updated = await plane.update("task", created.id, { title: "y", done: true }, CTX())
        assert.equal(updated.title, "y")
        assert.equal(updated.done, true)
        assert.equal(updated.created_at, CLOCK)
        assert.equal(updated.owner, "u1")
        assert.notEqual(updated.updated_at, CLOCK)
        await Test.assert.rejects(plane.update("task", ulid(), { title: "z" }, CTX()), "E_NOT_FOUND")
        const scoped = CTX({ policies: [policy({ rule: doc(leaf("priority", "eq", "high")) })] })
        await Test.assert.rejects(plane.update("task", created.id, { title: "z" }, scoped), "E_NOT_FOUND")
        await Test.assert.rejects(plane.update("task", created.id, { title: null }, CTX()), "E_REQUIRED")
    })

    Test.it("DPL-08 a patch cannot move a row outside the caller's permission scope", async () => {
        const { plane } = makePlane()
        const scoped = CTX({ policies: [policy({ rule: doc(leaf("priority", "eq", "high")) })] })
        const created = await plane.create("task", { title: "x", priority: "high" }, scoped)
        await Test.assert.rejects(plane.update("task", created.id, { priority: "low" }, scoped), "E_FORBIDDEN_ROW")
        const untouched = await plane.get("task", created.id, scoped)
        assert.equal(untouched.priority, "high")
    })

    Test.it("DPL-09 remove honors ifOwner — you delete yours, never theirs", async () => {
        const { plane } = makePlane()
        const owned = CTX({ user: "u1", policies: [policy({ ifOwner: true })] })
        const other = CTX({ user: "u2", policies: [policy({ ifOwner: true })] })
        const mine = await plane.create("task", { title: "mine" }, owned)
        const theirs = await plane.create("task", { title: "theirs" }, other)
        await Test.assert.rejects(plane.remove("task", theirs.id, owned), "E_NOT_FOUND")
        assert.equal(await plane.remove("task", mine.id, owned), true)
        assert.equal(await plane.get("task", mine.id, owned), null)
        assert.truthy(await plane.get("task", theirs.id, other))
    })

    Test.it("DPL-10 ULIDs are 26-char Crockford, unique, and time-ordered", () => {
        const ids = new Set()
        for (let i = 0; i < 2000; i++) ids.add(ulid())
        assert.equal(ids.size, 2000)
        for (const id of [...ids].slice(0, 50)) assert.truthy(/^[0-9A-HJKMNP-TV-Z]{26}$/.test(id))
        const early = ulid(1000000000000)
        const late = ulid(2000000000000)
        assert.truthy(early < late, "lexicographic order must follow time")
    })

    Test.it("DPL-11 create accepts an explicit id via options — the sync-fold replay seam", async () => {
        const { plane } = makePlane()
        const fixed = ulid()
        const row = await plane.create("task", { title: "replayed" }, CTX(), { id: fixed })
        assert.equal(row.id, fixed)
        assert.truthy(await plane.get("task", fixed, CTX()))
    })

    Test.it("DPL-12 unknown entities are rejected loudly", async () => {
        const { plane } = makePlane()
        await Test.assert.rejects(plane.create("ghost", { a: 1 }, CTX()), "E_ENTITY")
        await Test.assert.rejects(plane.list("ghost", {}, CTX()), "E_ENTITY")
    })
})
