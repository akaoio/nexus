/**
 * <nx-row> in a real browser (NXROW-DOM-*). The pure detail helper is asserted
 * under Node; everything below needs a document, so it runs in the browser
 * suite — the split the Studio suites already use.
 *
 * Note the suite NAME carries "browser": `{ browser: true }` controls whether
 * Node SKIPS the clauses, but the browser runner selects suites by matching
 * their name. Two different mechanisms — a suite with the flag and without the
 * word registers, skips under Node, and then silently never runs anywhere.
 */

import Test, { assert } from "../../src/core/Test.js"
import "../../src/studio/components/row/index.js"

Test.describe("Studio — <nx-row> in the DOM (NXROW-DOM, browser)", () => {

    Test.it("NXROW-DOM01 the row renders its label, its detail, and the caller's lead and tail — in that order", () => {
        const lead = document.createElement("span")
        lead.id = "lead"
        const tail = document.createElement("button")
        tail.id = "tail"

        const row = document.createElement("nx-row")
        row.dataset.label = "alice"
        row.dataset.detail = "pub-key-abc"
        row.lead = lead
        row.tail = tail
        document.body.append(row)

        assert.equal(row.className, "nx-row", "it keeps the page-level class its styling hangs on")
        assert.deepEqual([...row.children].map((c) => c.id || c.className), ["lead", "nx-who", "tail"])
        assert.truthy(row.textContent.includes("alice"))
        assert.truthy(row.textContent.includes("pub-key-abc"))
        assert.truthy(row.querySelector(".nx-pub"), "the detail keeps its own class")
        row.remove()
    })

    Test.it("NXROW-DOM02 a row with nothing to say underneath does not reserve a line for it", () => {
        const row = document.createElement("nx-row")
        row.dataset.label = "just a label"
        document.body.append(row)
        assert.falsy(row.querySelector(".nx-pub"), "an absent detail must leave no empty element behind")
        assert.equal(row.children.length, 1)
        row.remove()
    })

    Test.it("NXROW-DOM03 changing the label repaints, and does not accumulate", () => {
        const row = document.createElement("nx-row")
        row.dataset.label = "before"
        document.body.append(row)
        row.dataset.label = "after"
        assert.truthy(row.textContent.includes("after"))
        assert.falsy(row.textContent.includes("before"), "a repaint replaces, it does not append")
        assert.equal(row.children.length, 1)
        row.remove()
    })
}, { browser: true })
