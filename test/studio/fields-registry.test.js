/**
 * The field registry earns its place (NXFR-*) — ARCHITECTURE.md §7.1's
 * "sinh UI từ schema" contract, and STATUS's "component discipline is not yet
 * total" entry.
 *
 * §7.1 is explicit: *"Thêm kiểu field = thêm một entry trong fields.js, không
 * viết UI riêng cho từng field/Entity"* — a new field kind is a registry entry,
 * never per-entity UI code. `kit/fields.js` and `buildForm()` exist and honour
 * that. `routes/users` does not: it hand-builds a whole form for `nexus_user`,
 * including a roles multi-select with free entry, ~20 `createElement` calls of
 * UI that no other entity can reuse and that the registry cannot see.
 *
 * The awkward part, and why this needed a seam rather than a new field type:
 * `nexus_user.roles` is a `text` field holding JSON. The registry is keyed by
 * TYPE, so a text field cannot become a role picker without either a new field
 * type — Model Schema v1 is frozen (N4), so that is a format version, not an
 * afternoon — or a documented per-field override. The override keeps §7.1's
 * rule intact (the registry stays type-keyed, the widget stays reusable) while
 * giving the one case that genuinely needs it somewhere honest to live.
 */

import Test, { assert } from "../../src/core/Test.js"
import { readFileSync } from "fs"
import { fileURLToPath } from "url"
import { resolveInterface } from "../../src/studio/kit/registry.js"
import { parseTags, serializeTags } from "../../src/studio/kit/tags.js"

// A stand-in registry. Asserting the RULE against a fake is stronger than
// asserting it against the real one: it cannot pass by accident because the
// real registry happens to contain the key being looked up.
const registry = { text: "TEXT", boolean: "BOOL", select: "SELECT", tags: "TAGS" }

Test.describe("Field registry and its override seam (NXFR)", () => {

    Test.it("NXFR-01 the registry resolves by TYPE, and falls back to text for a type it does not know", () => {
        // The fallback matters: an entity carrying a field type this Studio
        // build predates must still be EDITABLE, not blank.
        assert.equal(resolveInterface({ name: "a", type: "boolean" }, registry), "BOOL")
        assert.equal(resolveInterface({ name: "a", type: "select" }, registry), "SELECT")
        assert.equal(resolveInterface({ name: "a", type: "something-new" }, registry), "TEXT")
    })

    Test.it("NXFR-02 a caller may override ONE field's interface without touching the type registry", () => {
        // This is the seam that lets routes/users stop hand-building a form.
        // It is per-CALL, not global: overriding `roles` on the users page must
        // not change how a `text` field renders anywhere else.
        const custom = "CUSTOM"
        assert.equal(resolveInterface({ name: "roles", type: "text" }, registry, { roles: custom }), custom)
        assert.equal(resolveInterface({ name: "bio", type: "text" }, registry, { roles: custom }), "TEXT")
        assert.equal(resolveInterface({ name: "roles", type: "text" }, registry), "TEXT")
    })

    Test.it("NXFR-03 tags round-trip through the JSON a text field actually stores", () => {
        // The users route stored roles as a JSON array in a text column and
        // parsed it in three places, each with its own idea of what a malformed
        // value means. One pair of functions, one answer.
        assert.deepEqual(parseTags(JSON.stringify(["admin", "editor"])), ["admin", "editor"])
        assert.equal(serializeTags(["admin", "editor"]), '["admin","editor"]')
        assert.deepEqual(parseTags(serializeTags(["a"])), ["a"])

        // A row written before this, or by hand, must not blank the editor.
        assert.deepEqual(parseTags(null), [])
        assert.deepEqual(parseTags(""), [])
        assert.deepEqual(parseTags("not json"), [], "malformed reads as empty, never throws into the render")
        assert.deepEqual(parseTags('"a string"'), [], "and a non-array is not silently treated as one")

        // Duplicates and blanks are the two things a free-entry picker produces.
        assert.deepEqual(parseTags('["a","a"," ","b"]'), ["a", "b"])
    })

    Test.it("NXFR-04 INVARIANT: the tags widget lives in the registry, and the users route no longer hand-builds a form", () => {
        // Structural, in the style of NXSR-KEY-02: the refactor is only durable
        // if putting the widget back inside a route fails a clause rather than
        // merely looking wrong in review.
        const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8")

        assert.truthy(/^\s*tags:/m.test(read("../../src/studio/kit/fields.js")),
            "the roles picker was ~20 createElement calls no other entity could reach")

        const users = read("../../src/studio/routes/users/index.js")
        assert.truthy(/buildForm\(/.test(users), "the users route must GENERATE its form from the schema (§7.1)")
        assert.falsy(/type = "checkbox"|type: "checkbox"/.test(users),
            "and must not rebuild a picker the registry already owns")
        // The third reader of the same value. A bare JSON.parse on a roles
        // column written by hand threw inside load() and took the page down,
        // where "no roles yet" is the honest answer.
        assert.falsy(/JSON\.parse\(row\.roles\)/.test(users), "one reader for a stored tag list, not three")
    })
})
