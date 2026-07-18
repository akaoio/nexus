/**
 * Studio conformance — <nx-list-view> (NXL-*).
 * Pure helpers in Node (sorting with the framework's null semantics,
 * grouping, RFC-4180 CSV); the table behavior in the browser run.
 */

import Test, { assert } from "../../src/core/Test.js"
import { toCSV, columnsFor, NxListView } from "../../src/studio/components/list-view/index.js"
import { sortRows, groupRows } from "../../src/core/Views.js"
import { schema, field } from "../conformance/model/_helpers.js"

const TASK = schema({
    name: "task",
    fields: [field("title", "text"), field("priority", "select", { options: ["low", "high"] }), field("points", "integer")]
})

const ROWS = [
    { id: "1", title: "b", priority: "high", points: 3, owner: "u1" },
    { id: "2", title: "a", priority: "low", points: null, owner: "u1" },
    { id: "3", title: "c", priority: "high", points: 1, owner: "u2" }
]

Test.describe("Studio — list-view helpers (NXL)", () => {
    Test.it("NXL-01 sortRows: strict types, both directions, nulls ALWAYS last", () => {
        assert.deepEqual(sortRows(ROWS, "points", "asc").map((r) => r.id), ["3", "1", "2"])
        assert.deepEqual(sortRows(ROWS, "points", "desc").map((r) => r.id), ["1", "3", "2"]) // null still last
        assert.deepEqual(sortRows(ROWS, "title", "asc").map((r) => r.title), ["a", "b", "c"])
        assert.deepEqual(ROWS.map((r) => r.id), ["1", "2", "3"], "input untouched")
    })

    Test.it("NXL-02 groupRows: value buckets in first-seen order; null/missing → (none)", () => {
        const groups = groupRows(ROWS, "priority")
        assert.deepEqual([...groups.keys()], ["high", "low"])
        assert.equal(groups.get("high").length, 2)
        const none = groupRows(ROWS, "points")
        assert.truthy(none.has("(none)"))
    })

    Test.it("NXL-03 toCSV quotes commas, quotes and newlines per RFC 4180", () => {
        const csv = toCSV([{ a: 'say "hi"', b: "x,y", c: "l1\nl2", d: null }], ["a", "b", "c", "d"])
        assert.equal(csv, 'a,b,c,d\n"say ""hi""","x,y","l1\nl2",')
    })

    Test.it("NXL-04 columnsFor: id + non-table fields + owner; module imports in Node", () => {
        assert.deepEqual(columnsFor(TASK), ["id", "title", "priority", "points", "owner"])
        assert.equal(typeof NxListView, "function")
    })
})

Test.describe("Studio — <nx-list-view> (NXL, browser)", () => {
    const mountView = () => {
        const view = document.createElement("nx-list-view")
        view.schema = TASK
        view.rows = ROWS
        document.body.appendChild(view)
        return view
    }
    const cells = (view, selector) => [...view.shadowRoot.querySelectorAll(selector)]

    Test.it("NXL-10 renders schema columns and every row", () => {
        const view = mountView()
        assert.deepEqual(cells(view, "th").map((t) => t.textContent), ["id", "title", "priority", "points", "owner"])
        assert.equal(cells(view, "tbody tr").length, 3)
        assert.truthy(view.shadowRoot.querySelector(".count").textContent.includes("3"))
        view.remove()
    })

    Test.it("NXL-11 header clicks sort asc, then desc — nulls stay last", () => {
        const view = mountView()
        const header = () => cells(view, "th").find((t) => t.dataset.column === "points")
        header().click()
        assert.deepEqual(view.displayed.map((r) => r.id), ["3", "1", "2"])
        header().click()
        assert.deepEqual(view.displayed.map((r) => r.id), ["1", "3", "2"])
        assert.truthy(header().textContent.includes("↓"))
        view.remove()
    })

    Test.it("NXL-12 group-by renders group heads with counts", () => {
        const view = mountView()
        const select = view.shadowRoot.querySelector(".group-by")
        select.value = "priority"
        select.dispatchEvent(new Event("change"))
        const heads = cells(view, "tr.group-head td").map((t) => t.textContent)
        assert.deepEqual(heads, ["priority: high (2)", "priority: low (1)"])
        assert.equal(cells(view, "tbody tr").length, 5) // 2 heads + 3 rows
        view.remove()
    })

    Test.it("NXL-13 the csv getter reflects the current view", () => {
        const view = mountView()
        const csv = view.csv
        assert.truthy(csv.startsWith("id,title,priority,points,owner"))
        assert.equal(csv.split("\n").length, 4)
        view.remove()
    })
}, { browser: true })
