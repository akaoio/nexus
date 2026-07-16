/**
 * Studio conformance — <nx-schema-designer> (NXS-*).
 *
 * Live Model.diff classification over an embedded nx-form-builder (the
 * second reuse), rename declaration with same-type guardrails, and the
 * contract that matters most: the migration document the designer emits is
 * DIRECTLY consumable by applyMigration on a real engine (pinned in Node
 * with node:sqlite).
 */

import Test, { assert } from "../../src/kernel/Test.js"
import { renameCandidates, designerPlan, NxSchemaDesigner } from "../../src/studio/schema-designer.js"
import { applyMigration } from "../../src/data/migrate.js"
import { tableDDL } from "../../src/data/ddl.js"
import { createCompiler } from "../../src/data/kysely.js"
import { schema, field } from "../conformance/model/_helpers.js"

const BASE = () =>
    schema({
        name: "task",
        fields: [field("title", "text", { required: true }), field("age", "integer"), field("done", "boolean")]
    })

Test.describe("Studio — schema-designer helpers (NXS)", () => {
    Test.it("NXS-01 renameCandidates offers only same-type added fields per removed field", () => {
        const current = BASE()
        current.fields = [
            field("title", "text", { required: true }),
            field("years", "integer"), // same type as removed age
            field("nick", "text"), // different type — not a candidate for age
            field("done", "boolean")
        ]
        const base = BASE()
        base.fields = base.fields.filter((f) => f.name !== "age").concat([field("age", "integer")])
        assert.deepEqual(renameCandidates(BASE(), current), { age: ["years"] })
    })

    Test.it("NXS-02 designerPlan: additive-only is hot with no migration; structural carries one", () => {
        const additive = BASE()
        additive.fields.push(field("nick", "text"))
        const hot = designerPlan(BASE(), additive)
        assert.equal(hot.hot, true)
        assert.equal(hot.migration, null)
        assert.truthy(hot.changes.every((c) => c.class === "additive"))

        const structural = BASE()
        structural.fields = structural.fields.filter((f) => f.name !== "age")
        const plan = designerPlan(BASE(), structural)
        assert.equal(plan.hot, false)
        assert.equal(plan.migration.entity, "task")
        assert.truthy(plan.migration.id.startsWith("task_"))
    })

    Test.it("NXS-03 declared renames bake into the migration; stale renames drop out silently", () => {
        const current = BASE()
        current.fields = current.fields.map((f) => (f.name === "age" ? field("years", "integer") : f))
        const withRename = designerPlan(BASE(), current, { age: "years" })
        assert.deepEqual(withRename.migration.renames, { age: "years" })
        const stale = designerPlan(BASE(), current, { age: "ghost", phantom: "years" })
        assert.deepEqual(stale.migration.renames, {})
        assert.notEqual(withRename.migration.id, stale.migration.id) // renames are part of identity
    })

    Test.it("NXS-04 honest edges: invalid schemas and entity renames produce no plan, only the flag", () => {
        const invalid = BASE()
        invalid.fields.push({ name: "Bad Name", type: "text" })
        assert.deepEqual(designerPlan(BASE(), invalid), { hot: false, changes: [], migration: null, reason: "invalid" })
        const renamed = BASE()
        renamed.name = "todo"
        const plan = designerPlan(BASE(), renamed)
        assert.equal(plan.reason, "entity-renamed")
        assert.equal(plan.migration, null)
    })

    Test.it("NXS-05 THE CONTRACT: the designer's migration applies on a real engine, rename preserved", async () => {
        const current = BASE()
        current.fields = current.fields.map((f) => (f.name === "age" ? field("years", "integer") : f))
        const plan = designerPlan(BASE(), current, { age: "years" })

        // node:sqlite is imported lazily — this clause runs in Node only,
        // and a static import would break the browser page's module graph
        const { DatabaseSync } = await import("node:sqlite")
        const db = new DatabaseSync(":memory:")
        const kysely = createCompiler("sqlite")
        for (const builder of tableDDL(kysely, BASE())) db.exec(builder.compile().sql)
        db.prepare("INSERT INTO task (id, title, age) VALUES ('01A', 'alice', 30)").run()
        const executor = {
            run: (sql, params = []) => void db.prepare(sql).run(...params),
            all: (sql, params = []) => db.prepare(sql).all(...params)
        }
        const dry = await applyMigration(executor, kysely, plan.migration) // dry-run default
        assert.equal(dry.dryRun, true)
        assert.deepEqual(dry.report.lost, {}) // the rename preserves the data
        const applied = await applyMigration(executor, kysely, plan.migration, { dryRun: false })
        assert.equal(applied.report.copied, 1)
        assert.equal(db.prepare("SELECT years FROM task").get().years, 30)
    })

    Test.it("NXS-06 the module imports in Node — class defined, registration browser-only", () => {
        assert.equal(typeof NxSchemaDesigner, "function")
    })
})

// ─── Browser: the live designer ───────────────────────────────────────────────

function mountDesigner(baseline) {
    const designer = document.createElement("nx-schema-designer")
    designer.baseline = baseline
    let last = null
    designer.addEventListener("change", (e) => (last = e.detail))
    document.body.appendChild(designer)
    return { designer, lastChange: () => last }
}

const panel = (designer) => designer.shadowRoot.querySelector(".panel")

Test.describe("Studio — <nx-schema-designer> (NXS, browser)", () => {
    Test.it("NXS-10 mounts the SECOND REUSE: an embedded nx-form-builder, with a clean baseline verdict", () => {
        const { designer } = mountDesigner(BASE())
        const builder = designer.shadowRoot.querySelector("nx-form-builder")
        assert.truthy(builder, "the editor IS nx-form-builder")
        assert.truthy(panel(designer).textContent.includes("no changes"))
        assert.deepEqual(designer.value, BASE())
        designer.remove()
    })

    Test.it("NXS-11 adding a field via the embedded builder shows a live additive badge — hot verdict", () => {
        const { designer, lastChange } = mountDesigner(BASE())
        designer.shadowRoot.querySelector("nx-form-builder").shadowRoot.querySelector(".add-field").click()
        assert.equal(lastChange().hot, true)
        assert.equal(lastChange().migration, null)
        assert.truthy(panel(designer).querySelector(".badge.additive"))
        assert.truthy(panel(designer).textContent.includes("hot-applicable"))
        designer.remove()
    })

    Test.it("NXS-12 removing a field flips to structural with a live migration document", () => {
        const { designer, lastChange } = mountDesigner(BASE())
        const builder = designer.shadowRoot.querySelector("nx-form-builder")
        builder.shadowRoot.querySelectorAll(".rows .row")[1].querySelector(".remove").click() // drop age
        assert.equal(lastChange().hot, false)
        assert.truthy(lastChange().migration.id.startsWith("task_"))
        assert.truthy(panel(designer).querySelector(".badge.structural"))
        assert.truthy(panel(designer).textContent.includes("requires a migration"))
        designer.remove()
    })

    Test.it("NXS-13 the rename flow: drop + add same type → dropdown declares the rename into the migration", () => {
        const { designer, lastChange } = mountDesigner(BASE())
        const builder = designer.shadowRoot.querySelector("nx-form-builder")
        // drop age, add an integer field, name it years
        builder.shadowRoot.querySelectorAll(".rows .row")[1].querySelector(".remove").click()
        builder.shadowRoot.querySelector(".add-field").click()
        const newRow = [...builder.shadowRoot.querySelectorAll(".rows .row")].at(-1)
        const type = newRow.querySelector(".type")
        type.value = "integer"
        type.dispatchEvent(new Event("change"))
        const name = [...builder.shadowRoot.querySelectorAll(".rows .row")].at(-1).querySelector(".name")
        name.value = "years"
        name.dispatchEvent(new Event("input"))

        const select = panel(designer).querySelector('[data-rename-from="age"]')
        assert.truthy(select, "the rename dropdown appeared for the removed field")
        assert.truthy([...select.options].some((o) => o.value === "years"))
        select.value = "years"
        select.dispatchEvent(new Event("change"))
        assert.deepEqual(lastChange().migration.renames, { age: "years" })
        designer.remove()
    })

    Test.it("NXS-14 boundary regression: the inner builder's events never masquerade as the designer's", () => {
        const { designer, lastChange } = mountDesigner(BASE())
        designer.shadowRoot.querySelector("nx-form-builder").shadowRoot.querySelector(".add-field").click()
        const detail = lastChange()
        assert.truthy("hot" in detail && "migration" in detail, "the detail is the DESIGNER's shape")
        assert.equal(detail.value.schemaVersion, 1)
        designer.remove()
    })

    Test.it("NXS-15 entity rename warns honestly and produces no plan", () => {
        const { designer, lastChange } = mountDesigner(BASE())
        const nameInput = designer.shadowRoot.querySelector("nx-form-builder").shadowRoot.querySelector(".entity-name")
        nameInput.value = "todo"
        nameInput.dispatchEvent(new Event("input"))
        assert.equal(lastChange().reason, "entity-renamed")
        assert.equal(lastChange().migration, null)
        assert.truthy(panel(designer).textContent.includes("entity renamed"))
        designer.remove()
    })
}, { browser: true })
