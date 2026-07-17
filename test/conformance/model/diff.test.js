/**
 * Model Schema v1 conformance — CHANGE CLASSIFICATION (MS-D).
 *
 * Defines Model.diff(oldSchema, newSchema): the input to the hybrid
 * Migration Engine (ARCHITECTURE.md §4.4). Every change is classified
 * "additive" (safe for hot DDL at runtime) or "structural" (requires a
 * reviewed migration + dry-run + confirmation). This classification IS the
 * safety boundary — misclassifying structural as additive loses data, so
 * these clauses are security-grade.
 *
 * Spec decisions encoded here:
 *  - additive: adding a nullable field; adding a required field WITH a
 *    default; adding/removing an index; label/help changes; adding a select
 *    option; loosening required; dropping unique.
 *  - structural: adding a required field without default; type changes;
 *    removing a field; removing a select option; tightening required;
 *    adding unique; changing link/table target.
 *  - Renames are indistinguishable from drop+add and are classified as such
 *    (structural) — a rename intent is expressed in a migration file, not
 *    guessed by diff.
 *  - diff is pure and returns [] for identical schemas.
 */

import Test, { assert } from "../../../src/core/Test.js"
import Model from "./_load.js"
import { schema, field, changeFor } from "./_helpers.js"

const base = () =>
    schema({
        fields: [
            field("full_name", "text", { required: true }),
            field("tier", "select", { options: ["bronze", "silver", "gold"] }),
            field("age", "integer")
        ]
    })

const withFields = (fields) => schema({ fields })

Test.describe("Model Schema v1 — change classification (MS-D)", () => {
    Test.it("MS-D01 identical schemas diff to an empty change list", () => {
        assert.deepEqual(Model.diff(base(), base()), [])
    })

    Test.it("MS-D02 adding a nullable field is additive", () => {
        const next = base()
        next.fields.push(field("nick", "text"))
        assert.equal(changeFor(Model.diff(base(), next), "nick").class, "additive")
    })

    Test.it("MS-D03 adding a required field: with default additive, without structural", () => {
        const withDefault = base()
        withDefault.fields.push(field("status", "text", { required: true, default: "new" }))
        assert.equal(changeFor(Model.diff(base(), withDefault), "status").class, "additive")

        const noDefault = base()
        noDefault.fields.push(field("status", "text", { required: true }))
        assert.equal(changeFor(Model.diff(base(), noDefault), "status").class, "structural")
    })

    Test.it("MS-D04 changing a field type is structural", () => {
        const next = withFields([field("full_name", "text", { required: true }), field("tier", "select", { options: ["bronze", "silver", "gold"] }), field("age", "number")])
        assert.equal(changeFor(Model.diff(base(), next), "age").class, "structural")
    })

    Test.it("MS-D05 removing a field is structural", () => {
        const next = base()
        next.fields = next.fields.filter((f) => f.name !== "age")
        assert.equal(changeFor(Model.diff(base(), next), "age").class, "structural")
    })

    Test.it("MS-D06 a rename is reported as drop+add (both structural) — never guessed", () => {
        const next = base()
        next.fields = next.fields.map((f) => (f.name === "age" ? field("years", "integer") : f))
        const changes = Model.diff(base(), next)
        assert.equal(changeFor(changes, "age").class, "structural")
        assert.equal(changeFor(changes, "years").class, "structural")
    })

    Test.it("MS-D07 adding or removing an index is additive", () => {
        const withIndex = base()
        withIndex.indexes = [{ fields: ["tier"] }]
        assert.equal(Model.diff(base(), withIndex)[0].class, "additive")
        assert.equal(Model.diff(withIndex, base())[0].class, "additive")
    })

    Test.it("MS-D08 label changes are additive (metadata only)", () => {
        const next = base()
        next.label = { en: "Client" }
        assert.equal(Model.diff(base(), next)[0].class, "additive")
    })

    Test.it("MS-D09 select options: adding is additive, removing is structural", () => {
        const added = base()
        added.fields[1].options = ["bronze", "silver", "gold", "platinum"]
        assert.equal(changeFor(Model.diff(base(), added), "tier").class, "additive")

        const removed = base()
        removed.fields[1].options = ["bronze", "silver"]
        assert.equal(changeFor(Model.diff(base(), removed), "tier").class, "structural")
    })

    Test.it("MS-D10 required: loosening is additive, tightening is structural", () => {
        const loosened = base()
        loosened.fields[0].required = false
        assert.equal(changeFor(Model.diff(base(), loosened), "full_name").class, "additive")

        const tightened = base()
        tightened.fields[2].required = true
        assert.equal(changeFor(Model.diff(base(), tightened), "age").class, "structural")
    })

    Test.it("MS-D11 unique: adding is structural (existing data may violate), dropping is additive", () => {
        const added = base()
        added.fields[0].unique = true
        assert.equal(changeFor(Model.diff(base(), added), "full_name").class, "structural")
        assert.equal(changeFor(Model.diff(added, base()), "full_name").class, "additive")
    })

    Test.it("MS-D12 changing a link/table target is structural", () => {
        const a = withFields([field("manager", "link", { target: "user" })])
        const b = withFields([field("manager", "link", { target: "employee" })])
        assert.equal(changeFor(Model.diff(a, b), "manager").class, "structural")
    })

    Test.it("MS-D13 diff is pure — neither schema is mutated", () => {
        const a = base()
        const b = base()
        b.fields.push(field("nick", "text"))
        const sa = JSON.stringify(a)
        const sb = JSON.stringify(b)
        Model.diff(a, b)
        assert.equal(JSON.stringify(a), sa)
        assert.equal(JSON.stringify(b), sb)
    })
})
