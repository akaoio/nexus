/**
 * One definition of a labelled field (NXFP-*) — ARCHITECTURE.md §7.1's
 * "Một kit (lib.js) cho DOM/toast/api/i18n/theme — không fetch/dựng DOM rải rác."
 *
 * FOUR files each defined the same two primitives independently: the
 * `.nx-field` + `.nx-label` wrapper and the `.nx-input`-classed control.
 * `kit/fields.js` had both (one inside buildForm, one private), and
 * routes/settings, routes/entities and routes/entity/[entity] each rebuilt
 * them. Changing what a labelled field looks like meant finding four places
 * and hoping.
 *
 * This was NOT the conclusion of the previous pass. PR #24 looked at the same
 * routes, counted `createElement` calls, and concluded the remaining DOM was
 * "layout shapes that appear once each, so there is no repeated widget to
 * extract". That was wrong, and wrong because it was a count rather than a
 * read: the duplication was not a WIDGET repeated across routes, it was two
 * PRIMITIVES redefined in every file that needed them.
 */

import { readFileSync, readdirSync } from "fs"
import { fileURLToPath } from "url"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"

const STUDIO = fileURLToPath(new URL("../../src/studio", import.meta.url))
const KIT_FIELDS = join(STUDIO, "kit", "fields.js")

const sourcesUnder = (dir, skip = []) => {
    const out = []
    const walk = (d) => {
        for (const entry of readdirSync(d, { withFileTypes: true })) {
            const path = join(d, entry.name)
            if (entry.isDirectory()) walk(path)
            else if (entry.name.endsWith(".js") && !skip.some((s) => path.endsWith(s))) out.push(path)
        }
    }
    walk(dir)
    return out
}

Test.describe("One definition of a labelled field (NXFP)", () => {

    Test.it("NXFP-01 INVARIANT: only the kit defines the field wrapper and the classed control", () => {
        // Keyed on the CLASSES because that is what makes two blocks of DOM the
        // same thing to a reader and to the stylesheet. A route that wants a
        // labelled field asks the kit; a route that invents one drifts from it
        // silently, which is exactly what four files had already done.
        const offenders = []
        for (const path of sourcesUnder(STUDIO, ["kit/fields.js"])) {
            const src = readFileSync(path, "utf8")
            const hits = [
                /className = "nx-field"/.test(src) && "nx-field",
                /className = "nx-label"/.test(src) && "nx-label",
                /className = "nx-input"/.test(src) && "nx-input"
            ].filter(Boolean)
            if (hits.length) offenders.push(`${path.slice(STUDIO.length + 1)} (${hits.join(", ")})`)
        }
        assert.deepEqual(offenders, [], `these build field DOM instead of asking the kit:\n  ${offenders.join("\n  ")}`)
    })

    Test.it("NXFP-02 the kit EXPORTS both primitives, so asking is possible at all", () => {
        // An invariant that forbids something without providing the alternative
        // is just a rule people route around.
        const src = readFileSync(KIT_FIELDS, "utf8")
        assert.truthy(/export function labelledField|export const labelledField/.test(src), "the wrapper must be exported")
        assert.truthy(/export function control|export const control/.test(src), "and the classed control")
    })

    Test.it("NXFP-03 buildForm uses the same wrapper it exports — not a private copy", () => {
        // The point of extracting it is that ONE change reaches everything. A
        // buildForm still inlining its own wrapper would leave the generated
        // forms drifting from every hand-composed one.
        const src = readFileSync(KIT_FIELDS, "utf8")
        const buildForm = src.slice(src.indexOf("export function buildForm"))
        assert.truthy(/labelledField\(/.test(buildForm), "buildForm must compose the exported wrapper")
        assert.falsy(/className = "nx-field"/.test(buildForm), "and not rebuild it inline")
    })
})
