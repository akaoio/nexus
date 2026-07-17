/**
 * Studio conformance — <nx-form-builder> + <nx-form> (NXF-*).
 *
 * The pure schema-editing helpers are pinned in Node (including a seeded
 * mutation fuzz over the pure layer); the DOM behavior is pinned in the
 * browser run. THE golden invariant everywhere: the `valid` flag emitted by
 * the builder never disagrees with Model.validate.
 */

import Test, { assert } from "../../src/core/Test.js"
import { validate, FIELD_TYPES } from "../../src/core/Model.js"
import {
    emptyField,
    moveField,
    resetType,
    emptySchema,
    NxFormBuilder,
    NxForm
} from "../../src/studio/components/form-builder/index.js"
import { prng } from "../conformance/ast/_helpers.js"
import { schema, field } from "../conformance/model/_helpers.js"

const TASK = () =>
    schema({
        name: "task",
        fields: [
            field("title", "text", { required: true, label: { en: "Title" } }),
            field("done", "boolean"),
            field("priority", "select", { options: ["low", "high"] })
        ]
    })

Test.describe("Studio — form-builder helpers (NXF)", () => {
    Test.it("NXF-01 emptyField generates a free, valid name; the result validates", () => {
        const s = emptySchema()
        s.fields.push(emptyField(s)) // field_1
        s.fields.push(emptyField(s)) // field_2
        assert.deepEqual(s.fields.map((f) => f.name), ["field_1", "field_2"])
        assert.equal(validate(s).valid, true)
    })

    Test.it("NXF-02 moveField reorders within bounds and ignores out-of-range moves", () => {
        const fields = [{ name: "a" }, { name: "b" }, { name: "c" }]
        moveField(fields, 0, 1)
        assert.deepEqual(fields.map((f) => f.name), ["b", "a", "c"])
        moveField(fields, 2, 1) // clamped — no change
        assert.deepEqual(fields.map((f) => f.name), ["b", "a", "c"])
        moveField(fields, 2, -2)
        assert.deepEqual(fields.map((f) => f.name), ["c", "b", "a"])
    })

    Test.it("NXF-03 resetType keeps the schema valid across EVERY type transition", () => {
        for (const from of FIELD_TYPES)
            for (const to of FIELD_TYPES) {
                const s = emptySchema()
                const f = resetType({ name: "x", type: from }, from) // coherent start
                s.fields = [f]
                resetType(f, to)
                const result = validate(s)
                assert.truthy(result.valid, `${from}→${to}: ${JSON.stringify(result.errors)}`)
            }
    })

    Test.it("NXF-04 FUZZ (pure layer): random mutation sequences always yield validating schemas", () => {
        const rnd = prng(0xf0e2)
        const pick = (list) => list[Math.floor(rnd() * list.length)]
        const s = TASK()
        for (let i = 0; i < 120; i++) {
            const action = Math.floor(rnd() * 4)
            if (action === 0) s.fields.push(emptyField(s))
            else if (action === 1 && s.fields.length) s.fields.splice(Math.floor(rnd() * s.fields.length), 1)
            else if (action === 2 && s.fields.length)
                moveField(s.fields, Math.floor(rnd() * s.fields.length), rnd() < 0.5 ? -1 : 1)
            else if (s.fields.length) resetType(pick(s.fields), pick([...FIELD_TYPES]))
            const result = validate(s)
            assert.truthy(result.valid, `mutation #${i} broke the schema: ${JSON.stringify(result.errors)}`)
        }
    })

    Test.it("NXF-05 modules import in Node — classes defined, registration browser-only", () => {
        assert.equal(typeof NxFormBuilder, "function")
        assert.equal(typeof NxForm, "function")
    })
})

// ─── Browser: the editor + the runtime form ───────────────────────────────────

function mountBuilder(value) {
    const builder = document.createElement("nx-form-builder")
    if (value) builder.value = value
    let last = null
    builder.addEventListener("change", (e) => (last = e.detail))
    document.body.appendChild(builder)
    return { builder, lastChange: () => last }
}

const setInput = (el, value) => {
    el.value = value
    el.dispatchEvent(new Event("input"))
}
const setSelect = (el, value) => {
    el.value = value
    el.dispatchEvent(new Event("change"))
}
const rows = (builder) => [...builder.shadowRoot.querySelectorAll(".rows .row")]

Test.describe("Studio — <nx-form-builder> + <nx-form> (NXF, browser)", () => {
    Test.it("NXF-10 mounts from a schema, renders one row per field, round-trips byte-identically", () => {
        const { builder } = mountBuilder(TASK())
        assert.equal(rows(builder).length, 3)
        assert.deepEqual(builder.value, TASK())
        builder.remove()
    })

    Test.it("NXF-11 add field emits a valid schema with a generated unique name", () => {
        const { builder, lastChange } = mountBuilder(TASK())
        builder.shadowRoot.querySelector(".add-field").click()
        assert.equal(lastChange().valid, true)
        assert.equal(lastChange().value.fields.at(-1).name, "field_1")
        assert.equal(rows(builder).length, 4)
        builder.remove()
    })

    Test.it("NXF-12 the valid flag NEVER disagrees with Model.validate — bad name flagged, fix restores", () => {
        const { builder, lastChange } = mountBuilder(TASK())
        const name = rows(builder)[0].querySelector(".name")
        setInput(name, "1bad name")
        assert.equal(lastChange().valid, false)
        assert.equal(validate(lastChange().value).valid, false)
        setInput(name, "renamed_title")
        assert.equal(lastChange().valid, true)
        assert.equal(lastChange().value.fields[0].name, "renamed_title")
        builder.remove()
    })

    Test.it("NXF-13 type switches re-shape the row: select gets options, link gets target", () => {
        const { builder, lastChange } = mountBuilder(TASK())
        setSelect(rows(builder)[0].querySelector(".type"), "select")
        let row = rows(builder)[0]
        assert.truthy(row.querySelector(".options"), "select type shows the options editor")
        setInput(row.querySelector(".options"), "red, green, blue")
        assert.deepEqual(lastChange().value.fields[0].options, ["red", "green", "blue"])
        assert.equal(lastChange().valid, true)

        setSelect(rows(builder)[0].querySelector(".type"), "link")
        row = rows(builder)[0]
        assert.truthy(row.querySelector(".target"), "link type shows the target editor")
        setInput(row.querySelector(".target"), "user")
        assert.equal(lastChange().value.fields[0].target, "user")
        assert.equal(lastChange().valid, true)
        builder.remove()
    })

    Test.it("NXF-14 remove and reorder are reflected in the schema's field order", () => {
        const { builder, lastChange } = mountBuilder(TASK())
        rows(builder)[2].querySelector(".up").click()
        assert.deepEqual(lastChange().value.fields.map((f) => f.name), ["title", "priority", "done"])
        rows(builder)[0].querySelector(".remove").click()
        assert.deepEqual(lastChange().value.fields.map((f) => f.name), ["priority", "done"])
        assert.equal(lastChange().valid, true)
        builder.remove()
    })

    Test.it("NXF-15 required toggles; entity name and label edit through the header", () => {
        const { builder, lastChange } = mountBuilder(TASK())
        const box = rows(builder)[1].querySelector(".required")
        box.checked = true
        box.dispatchEvent(new Event("change"))
        assert.equal(lastChange().value.fields[1].required, true)
        setInput(builder.shadowRoot.querySelector(".entity-name"), "todo")
        setInput(builder.shadowRoot.querySelector(".entity-label"), "Todo")
        assert.equal(lastChange().value.name, "todo")
        assert.deepEqual(lastChange().value.label, { en: "Todo" })
        assert.equal(lastChange().valid, true)
        builder.remove()
    })

    Test.it("NXF-16 nx-form renders the schema: typed inputs, required mark, data in/out, submit", () => {
        const form = document.createElement("nx-form")
        form.schema = TASK()
        document.body.appendChild(form)
        let submitted = null
        form.addEventListener("submit", (e) => (submitted = e.detail.value))

        const title = form.shadowRoot.querySelector('[data-field="title"]')
        assert.equal(title.type, "text")
        assert.truthy(form.shadowRoot.querySelector(".required-mark"), "required fields are marked")
        setInput(title, "ship the form")
        const done = form.shadowRoot.querySelector('[data-field="done"]')
        done.checked = true
        done.dispatchEvent(new Event("change"))
        setSelect(form.shadowRoot.querySelector('[data-field="priority"]'), "high")

        form.shadowRoot.querySelector(".submit").click()
        assert.deepEqual(submitted, { title: "ship the form", done: true, priority: "high" })
        form.remove()
    })

    Test.it("NXF-17 the live preview is a real nx-form that follows the edits", () => {
        const { builder } = mountBuilder(TASK())
        const preview = builder.shadowRoot.querySelector("nx-form")
        assert.truthy(preview, "the builder embeds an nx-form preview")
        assert.equal(preview.shadowRoot.querySelectorAll("[data-field]").length, 3)
        builder.shadowRoot.querySelector(".add-field").click()
        const refreshed = builder.shadowRoot.querySelector("nx-form")
        assert.equal(refreshed.shadowRoot.querySelectorAll("[data-field]").length, 4)
        builder.remove()
    })
}, { browser: true })
