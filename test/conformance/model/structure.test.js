/**
 * Model Schema v1 conformance — STRUCTURE (MS-S).
 *
 * Defines the Entity schema envelope of ARCHITECTURE.md §4.1. Clause numbers
 * are immutable within schemaVersion 1.
 *
 * Spec decisions encoded here:
 *  - Envelope: { schemaVersion: 1, name, fields: [...] } plus optional
 *    label, indexes, semantic. The format is frozen: unknown keys are errors.
 *  - Entity and field names share the AST field-segment rule:
 *    /^[a-z][a-z0-9_]*$/.
 *  - Every entity implicitly carries the system fields id, owner,
 *    created_at, updated_at — declaring them yourself is an error.
 *  - label (entity- and field-level) is an i18n map { locale: string }.
 *  - permlevel is an integer 0–9 (field-level permission tiers, §4.3).
 *  - validate() mirrors the AST contract: never throws, returns
 *    { valid } | { valid, errors: [{code, path}] }.
 */

import Test, { assert } from "../../../src/kernel/Test.js"
import Model from "./_load.js"
import { schema, field, hasError } from "./_helpers.js"

Test.describe("Model Schema v1 — structure (MS-S)", () => {
    Test.it("MS-S01 a valid schema validates", () => {
        assert.equal(Model.validate(schema()).valid, true)
    })

    Test.it("MS-S02 entity name must match /^[a-z][a-z0-9_]*$/ — else E_ENTITY_NAME", () => {
        assert.truthy(hasError(Model.validate(schema({ name: "Customer" })), "E_ENTITY_NAME"))
        assert.truthy(hasError(Model.validate(schema({ name: "1st" })), "E_ENTITY_NAME"))
        assert.truthy(hasError(Model.validate(schema({ name: "a-b" })), "E_ENTITY_NAME"))
    })

    Test.it("MS-S03 fields must be an array — else E_FIELDS", () => {
        assert.truthy(hasError(Model.validate(schema({ fields: "nope" })), "E_FIELDS"))
        assert.truthy(hasError(Model.validate(schema({ fields: undefined })), "E_FIELDS"))
    })

    Test.it("MS-S04 an empty fields array is valid (system fields are implied)", () => {
        assert.equal(Model.validate(schema({ fields: [] })).valid, true)
    })

    Test.it("MS-S05 field names must match the segment rule — else E_FIELD_NAME", () => {
        assert.truthy(hasError(Model.validate(schema({ fields: [field("Full Name", "text")] })), "E_FIELD_NAME"))
        assert.truthy(hasError(Model.validate(schema({ fields: [field("a.b", "text")] })), "E_FIELD_NAME"))
    })

    Test.it("MS-S06 duplicate field names are E_DUP_FIELD", () => {
        const dup = schema({ fields: [field("x", "text"), field("x", "integer")] })
        assert.truthy(hasError(Model.validate(dup), "E_DUP_FIELD"))
    })

    Test.it("MS-S07 declaring a system field is E_RESERVED_FIELD", () => {
        for (const name of ["id", "owner", "created_at", "updated_at"]) {
            assert.truthy(
                hasError(Model.validate(schema({ fields: [field(name, "text")] })), "E_RESERVED_FIELD"),
                `${name} must be reserved`
            )
        }
    })

    Test.it("MS-S08 the system field list is pinned and frozen", () => {
        assert.deepEqual([...Model.SYSTEM_FIELDS].sort(), ["created_at", "id", "owner", "updated_at"])
        assert.truthy(Object.isFrozen(Model.SYSTEM_FIELDS))
    })

    Test.it("MS-S09 unknown keys are errors — frozen format (envelope and field level)", () => {
        assert.truthy(hasError(Model.validate(schema({ extra: 1 })), "E_SCHEMA_KEYS"))
        const f = { name: "x", type: "text", color: "red" }
        assert.truthy(hasError(Model.validate(schema({ fields: [f] })), "E_FIELD_KEYS"))
    })

    Test.it("MS-S10 labels are i18n maps of strings — else E_LABEL", () => {
        assert.equal(Model.validate(schema({ label: { en: "Customer", vi: "Khách hàng" } })).valid, true)
        assert.truthy(hasError(Model.validate(schema({ label: "Customer" })), "E_LABEL"))
        assert.truthy(hasError(Model.validate(schema({ label: { en: 42 } })), "E_LABEL"))
        const f = field("x", "text", { label: { en: 1 } })
        assert.truthy(hasError(Model.validate(schema({ fields: [f] })), "E_LABEL"))
    })

    Test.it("MS-S11 permlevel must be an integer 0–9 — else E_PERMLEVEL", () => {
        assert.equal(Model.validate(schema({ fields: [field("salary", "number", { permlevel: 9 })] })).valid, true)
        for (const bad of [-1, 10, 1.5, "1"]) {
            const s = schema({ fields: [field("salary", "number", { permlevel: bad })] })
            assert.truthy(hasError(Model.validate(s), "E_PERMLEVEL"), `permlevel ${bad}`)
        }
    })

    Test.it("MS-S12 indexes must reference declared fields and be non-empty", () => {
        assert.equal(Model.validate(schema({ indexes: [{ fields: ["tier", "age"] }] })).valid, true)
        assert.truthy(hasError(Model.validate(schema({ indexes: [{ fields: ["ghost"] }] })), "E_INDEX_FIELD"))
        assert.truthy(hasError(Model.validate(schema({ indexes: [{ fields: [] }] })), "E_INDEX_EMPTY"))
    })

    Test.it("MS-S13 a valid semantic block validates (format is v1, even before Phase 6 ships)", () => {
        const s = schema({
            semantic: {
                embed: [{ field: "full_name", weight: 2 }, { field: "tier" }],
                template: { en: "Customer {full_name}", vi: "Khách hàng {full_name}" },
                reindex: "on_update"
            }
        })
        assert.equal(Model.validate(s).valid, true)
    })

    Test.it("MS-S14 semantic.embed referencing an unknown field is E_SEMANTIC_FIELD", () => {
        const s = schema({ semantic: { embed: [{ field: "ghost" }] } })
        assert.truthy(hasError(Model.validate(s), "E_SEMANTIC_FIELD"))
    })

    Test.it("MS-S15 semantic weights must be positive numbers; reindex is on_update|manual", () => {
        const badWeight = schema({ semantic: { embed: [{ field: "tier", weight: -1 }] } })
        assert.truthy(hasError(Model.validate(badWeight), "E_SEMANTIC"))
        const badReindex = schema({ semantic: { embed: [{ field: "tier" }], reindex: "sometimes" } })
        assert.truthy(hasError(Model.validate(badReindex), "E_SEMANTIC"))
    })

    Test.it("MS-S16 errors carry a JSON-pointer path to the offending element", () => {
        const bad = schema({ fields: [field("ok", "text"), field("Bad", "text")] })
        const result = Model.validate(bad)
        assert.equal(result.valid, false)
        assert.equal(result.errors[0].path, "/fields/1")
    })

    Test.it("MS-S17 validate never throws — even on garbage input", () => {
        for (const garbage of [undefined, null, 42, "hi", [], {}, { schemaVersion: 1 }]) {
            assert.equal(typeof Model.validate(garbage).valid, "boolean")
        }
    })
})
