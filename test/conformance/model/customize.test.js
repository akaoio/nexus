/**
 * Model Schema v1 conformance — CUSTOMIZE WITHOUT FORKING (MS-C).
 *
 * Defines Model.merge(schema, customization): Frappe's best idea (Custom
 * Field + Property Setter), formalized. Customizations live apart from the
 * app's schema and are re-applied after every app update — the app author
 * and the site owner never fight over the same file.
 *
 * Spec decisions encoded here:
 *  - Customization document: { customFields: [field...],
 *    overrides: [{ field, property, value }] }.
 *  - Custom field names MUST start with "custom_" — a hard namespace that
 *    makes collision with future app updates impossible by construction
 *    (Frappe doesn't enforce this; collisions are a real-world failure mode).
 *  - Overridable properties are a closed set: label, default, options —
 *    and options may only be EXTENDED, never reduced. Everything else
 *    (type, target, required, unique, permlevel) is the app author's
 *    contract: E_OVERRIDE_FORBIDDEN.
 *  - merge is pure, its output validates, and re-merging the same
 *    customization onto an updated base preserves it (the update-safety
 *    property, N3).
 */

import Test, { assert } from "../../../src/core/Test.js"
import Model from "./_load.js"
import { schema, field } from "./_helpers.js"

const custom = (over = {}) => ({ customFields: [], overrides: [], ...over })
const findField = (merged, name) => merged.fields.find((f) => f.name === name)

Test.describe("Model Schema v1 — customize without forking (MS-C)", () => {
    Test.it("MS-C01 merge adds custom fields to the schema", () => {
        const merged = Model.merge(schema(), custom({ customFields: [field("custom_notes", "text")] }))
        assert.truthy(findField(merged, "custom_notes"))
        assert.equal(Model.validate(merged).valid, true)
    })

    Test.it("MS-C02 custom field names must start with custom_ — else E_CUSTOM_NAME", () => {
        assert.throws(() => Model.merge(schema(), custom({ customFields: [field("notes", "text")] })), "E_CUSTOM_NAME")
    })

    Test.it("MS-C03 a custom field colliding with a base field is E_CUSTOM_CONFLICT", () => {
        const colliding = custom({ customFields: [field("custom_x", "text"), field("custom_x", "integer")] })
        assert.throws(() => Model.merge(schema(), colliding), "E_CUSTOM_CONFLICT")
    })

    Test.it("MS-C04 overrides can change label and default", () => {
        const merged = Model.merge(
            schema(),
            custom({
                overrides: [
                    { field: "tier", property: "label", value: { en: "Level" } },
                    { field: "age", property: "default", value: 18 }
                ]
            })
        )
        assert.deepEqual(findField(merged, "tier").label, { en: "Level" })
        assert.equal(findField(merged, "age").default, 18)
    })

    Test.it("MS-C05 overrides may extend select options but never reduce them", () => {
        const extend = custom({
            overrides: [{ field: "tier", property: "options", value: ["bronze", "silver", "gold", "vip"] }]
        })
        const merged = Model.merge(schema(), extend)
        assert.deepEqual(findField(merged, "tier").options, ["bronze", "silver", "gold", "vip"])

        const reduce = custom({ overrides: [{ field: "tier", property: "options", value: ["gold"] }] })
        assert.throws(() => Model.merge(schema(), reduce), "E_OVERRIDE_FORBIDDEN")
    })

    Test.it("MS-C06 overriding a protected property (type, target, required…) is E_OVERRIDE_FORBIDDEN", () => {
        for (const [property, value] of [
            ["type", "number"],
            ["target", "other"],
            ["required", false],
            ["unique", true],
            ["permlevel", 0]
        ]) {
            const c = custom({ overrides: [{ field: "full_name", property, value }] })
            assert.throws(() => Model.merge(schema(), c), "E_OVERRIDE_FORBIDDEN", `property ${property}`)
        }
    })

    Test.it("MS-C07 overriding an unknown field is E_OVERRIDE_FIELD", () => {
        const c = custom({ overrides: [{ field: "ghost", property: "label", value: { en: "x" } }] })
        assert.throws(() => Model.merge(schema(), c), "E_OVERRIDE_FIELD")
    })

    Test.it("MS-C08 merge is pure — base schema and customization are not mutated", () => {
        const base = schema()
        const c = custom({ customFields: [field("custom_notes", "text")] })
        const sBase = JSON.stringify(base)
        const sC = JSON.stringify(c)
        Model.merge(base, c)
        assert.equal(JSON.stringify(base), sBase)
        assert.equal(JSON.stringify(c), sC)
    })

    Test.it("MS-C09 UPDATE SAFETY: re-merging onto an updated base preserves the customization", () => {
        const c = custom({
            customFields: [field("custom_notes", "text")],
            overrides: [{ field: "tier", property: "label", value: { en: "Level" } }]
        })
        // App author ships an update: adds a field, renames labels, adds an option.
        const updatedBase = schema()
        updatedBase.fields.push(field("region", "text"))
        updatedBase.fields[1].options = ["bronze", "silver", "gold", "platinum"]

        const merged = Model.merge(updatedBase, c)
        assert.truthy(findField(merged, "custom_notes"), "custom field survived the app update")
        assert.truthy(findField(merged, "region"), "app's new field is present")
        assert.deepEqual(findField(merged, "tier").label, { en: "Level" }, "override survived the app update")
        assert.equal(Model.validate(merged).valid, true)
    })
})
