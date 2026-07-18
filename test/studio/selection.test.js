/**
 * Selection model conformance (SEL-*) — the pure logic under every bulk
 * operation in every view. Frappe's list habits, pinned.
 */

import Test, { assert } from "../../src/core/Test.js"
import { createSelection } from "../../src/studio/kit/selection.js"

const IDS = ["a", "b", "c", "d"]

Test.describe("Studio — selection model (SEL-*)", () => {
    Test.it("SEL-01 toggle, all, clear and the tri-state", () => {
        const s = createSelection()
        assert.equal(s.stateOf(IDS), "none")
        s.toggle("a")
        assert.truthy(s.has("a"))
        assert.equal(s.stateOf(IDS), "some")
        s.toggle("a")
        assert.equal(s.size, 0)
        s.all(IDS)
        assert.equal(s.stateOf(IDS), "all")
        s.clear()
        assert.equal(s.size, 0)
    })

    Test.it("SEL-02 invert flips checked↔unchecked over the visible set (Frappe)", () => {
        const s = createSelection()
        s.toggle("a").toggle("b")
        s.invert(IDS)
        assert.deepEqual(new Set(s.ids), new Set(["c", "d"]))
        s.invert(IDS)
        assert.deepEqual(new Set(s.ids), new Set(["a", "b"]))
    })

    Test.it("SEL-03 selection outside the visible set survives an invert of the visible set", () => {
        const s = createSelection()
        s.toggle("z") // selected on another page/filter
        s.invert(IDS)
        assert.truthy(s.has("z"), "inverting the visible set never touches off-screen picks")
        assert.equal(s.size, 5)
    })

    Test.it("SEL-04 onChange fires once per operation with the api", () => {
        let calls = 0
        const s = createSelection(() => calls++)
        s.toggle("a")
        s.all(IDS)
        s.invert(IDS)
        s.clear()
        assert.equal(calls, 4)
    })
})
