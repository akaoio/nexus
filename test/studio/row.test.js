/**
 * <nx-row> — the list row as a COMPONENT (NXROW-*).
 *
 * ARCHITECTURE.md §7.1: widgets are `nx-*` components and modules merely
 * compose them. Three routes disagreed. `routes/users`, `routes/jobs` and
 * `routes/permissions` each hand-built the SAME shape — a `.nx-row` holding an
 * optional leading element, a `.nx-who` block of a label over a `.nx-pub`
 * detail line, and trailing controls — in about a dozen `createElement` calls
 * apiece, none of which the others could reuse.
 *
 * The detail LINE is the part worth extracting separately: jobs composes it
 * from several optional pieces and drops the empty ones, which is logic rather
 * than markup, and logic belongs where a clause can reach it under Node
 * (`components/row/detail.js` — the same split as kit/tags.js, and for the same
 * reason: anything that touches HTMLElement cannot be imported by the node
 * runner at all).
 */

import { readFileSync, readdirSync } from "fs"
import { fileURLToPath } from "url"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { detailLine } from "../../src/studio/components/row/detail.js"

const ROUTES = fileURLToPath(new URL("../../src/studio/routes", import.meta.url))

Test.describe("Studio — <nx-row> (NXROW)", () => {

    Test.it("NXROW-01 the detail line drops the parts that are not there, rather than printing their gaps", () => {
        // jobs builds this from attempts, an optional run_at and an optional
        // last_error. Joining without filtering produced " ·  · " for a job
        // that had neither.
        assert.equal(detailLine(["attempts 1/5", "runs 12:00", "boom"]), "attempts 1/5 · runs 12:00 · boom")
        assert.equal(detailLine(["attempts 1/5", null, undefined, "", false]), "attempts 1/5")
        assert.equal(detailLine([]), "")
        assert.equal(detailLine(null), "")
        assert.equal(detailLine(["  ", "a"]), "a", "whitespace is not a part")
        assert.equal(detailLine(["a", "b"], " / "), "a / b", "the separator is the caller's")
    })

    Test.it("NXROW-02 INVARIANT: no route hand-builds the row shape any more", () => {
        // Structural, like NXSR-KEY-02 and NXFR-04: the refactor is only
        // durable if rebuilding the shape inside a route fails a clause rather
        // than merely looking repetitive in review.
        const offenders = []
        const walk = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const path = join(dir, entry.name)
                if (entry.isDirectory()) walk(path)
                else if (entry.name.endsWith(".js")) {
                    const src = readFileSync(path, "utf8")
                    // `.nx-who` is what IDENTIFIES the row shape. `.nx-pub` on
                    // its own is a text style, and using it for a metadata
                    // block (entity/[entity]'s id/owner/created lines) is
                    // legitimate — banning the class outright would have forced
                    // a row component onto something that is not a row.
                    if (/className = "nx-who"/.test(src)) offenders.push(path.slice(ROUTES.length + 1))
                }
            }
        }
        walk(ROUTES)
        assert.deepEqual(offenders, [], `these still build the row by hand instead of using <nx-row>: ${offenders.join(", ")}`)
    })

    Test.it("NXROW-03 the component is registered under the name routes use", () => {
        const src = readFileSync(fileURLToPath(new URL("../../src/studio/components/row/index.js", import.meta.url)), "utf8")
        assert.truthy(/customElements\.define\("nx-row"/.test(src), "a widget nobody can instantiate is not a widget")
        // Light DOM, like nx-navlink: the row's styling is page-level
        // (.nx-row/.nx-who/.nx-pub), and a shadow root would cut it off from
        // the very stylesheet that gives it its shape.
        assert.falsy(/attachShadow/.test(src), "the row must stay in the light DOM to keep its page-level styling")
    })
})
