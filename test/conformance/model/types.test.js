/**
 * Model Schema v1 conformance — FIELD TYPES (MS-T).
 *
 * Defines the closed v1 field-type set and per-type property rules.
 *
 * Spec decisions encoded here:
 *  - v1 types (10, closed, frozen): boolean, date, datetime, file, integer,
 *    link, number, select, table, text. NO json type in v1 — JSON filtering
 *    is not portable across engines (ARCHITECTURE.md risk #1); it may arrive
 *    in a later schemaVersion as an adapter capability.
 *  - select requires non-empty, duplicate-free string options; options are
 *    forbidden elsewhere.
 *  - link/table require a target entity name; target is forbidden elsewhere.
 *  - default values must match the field type; date/datetime defaults are
 *    ISO strings.
 *  - unique applies to scalar types only.
 */

import Test, { assert } from "../../../src/core/Test.js"
import Model from "./_load.js"
import { schema, field, hasError } from "./_helpers.js"

const withField = (f) => schema({ fields: [f] })

Test.describe("Model Schema v1 — field types (MS-T)", () => {
    Test.it("MS-T01 the v1 type set is exactly these 10, frozen", () => {
        assert.deepEqual(
            [...Model.FIELD_TYPES].sort(),
            ["boolean", "date", "datetime", "file", "integer", "link", "number", "select", "table", "text"]
        )
        assert.truthy(Object.isFrozen(Model.FIELD_TYPES))
    })

    Test.it("MS-T02 an unknown type is E_UNKNOWN_TYPE", () => {
        assert.truthy(hasError(Model.validate(withField(field("x", "json"))), "E_UNKNOWN_TYPE"))
        assert.truthy(hasError(Model.validate(withField(field("x", "string"))), "E_UNKNOWN_TYPE"))
    })

    Test.it("MS-T03 select requires non-empty, duplicate-free string options", () => {
        assert.truthy(hasError(Model.validate(withField(field("x", "select"))), "E_PROP_REQUIRED"))
        assert.truthy(hasError(Model.validate(withField(field("x", "select", { options: [] }))), "E_OPTIONS"))
        assert.truthy(hasError(Model.validate(withField(field("x", "select", { options: ["a", "a"] }))), "E_OPTIONS"))
        assert.truthy(hasError(Model.validate(withField(field("x", "select", { options: [1] }))), "E_OPTIONS"))
    })

    Test.it("MS-T04 options on a non-select field are E_PROP_FORBIDDEN", () => {
        assert.truthy(hasError(Model.validate(withField(field("x", "text", { options: ["a"] }))), "E_PROP_FORBIDDEN"))
    })

    Test.it("MS-T05 link and table require a valid target entity name", () => {
        assert.truthy(hasError(Model.validate(withField(field("x", "link"))), "E_PROP_REQUIRED"))
        assert.truthy(hasError(Model.validate(withField(field("x", "table"))), "E_PROP_REQUIRED"))
        assert.truthy(hasError(Model.validate(withField(field("x", "link", { target: "Bad Name" }))), "E_ENTITY_NAME"))
        assert.equal(Model.validate(withField(field("x", "link", { target: "user" }))).valid, true)
    })

    Test.it("MS-T06 target on a non-link/table field is E_PROP_FORBIDDEN", () => {
        assert.truthy(hasError(Model.validate(withField(field("x", "text", { target: "user" }))), "E_PROP_FORBIDDEN"))
    })

    Test.it("MS-T07 defaults must match the field type — else E_DEFAULT_TYPE", () => {
        assert.equal(Model.validate(withField(field("x", "text", { default: "hi" }))).valid, true)
        assert.truthy(hasError(Model.validate(withField(field("x", "text", { default: 1 }))), "E_DEFAULT_TYPE"))
        assert.truthy(hasError(Model.validate(withField(field("x", "integer", { default: "1" }))), "E_DEFAULT_TYPE"))
        assert.truthy(hasError(Model.validate(withField(field("x", "boolean", { default: 1 }))), "E_DEFAULT_TYPE"))
    })

    Test.it("MS-T08 integer defaults must be whole numbers", () => {
        assert.equal(Model.validate(withField(field("x", "integer", { default: 5 }))).valid, true)
        assert.truthy(hasError(Model.validate(withField(field("x", "integer", { default: 1.5 }))), "E_DEFAULT_TYPE"))
    })

    Test.it("MS-T09 date/datetime defaults are ISO strings", () => {
        assert.equal(Model.validate(withField(field("x", "date", { default: "2026-07-15" }))).valid, true)
        assert.equal(
            Model.validate(withField(field("x", "datetime", { default: "2026-07-15T00:00:00.000Z" }))).valid,
            true
        )
        assert.truthy(hasError(Model.validate(withField(field("x", "date", { default: "15/07/2026" }))), "E_DEFAULT_TYPE"))
        assert.truthy(hasError(Model.validate(withField(field("x", "datetime", { default: 1234567890 }))), "E_DEFAULT_TYPE"))
    })

    Test.it("MS-T10 select defaults must be one of the options", () => {
        assert.equal(
            Model.validate(withField(field("x", "select", { options: ["a", "b"], default: "a" }))).valid,
            true
        )
        assert.truthy(
            hasError(Model.validate(withField(field("x", "select", { options: ["a"], default: "z" }))), "E_DEFAULT_TYPE")
        )
    })

    Test.it("MS-T11 unique applies to scalar types only — never to table fields", () => {
        assert.equal(Model.validate(withField(field("x", "text", { unique: true }))).valid, true)
        assert.truthy(
            hasError(
                Model.validate(withField(field("x", "table", { target: "child", unique: true }))),
                "E_PROP_FORBIDDEN"
            )
        )
    })
})
