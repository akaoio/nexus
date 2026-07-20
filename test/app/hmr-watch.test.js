/**
 * App — HMR file watcher (HMR-01/02).
 *
 * The watcher processes real filesystem changes with debouncing.
 * assetKind extracts HMR.js's own dispatch law as a pure seam.
 */

import Test, { assert } from "../../src/core/Test.js"
import { assetKind, createWatcher, devMessage } from "../../src/core/HMR/watch.js"
import { mkdtempSync, writeFileSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

Test.describe("App — HMR watcher (HMR)", () => {
    Test.it("HMR-01 assetKind maps by HMR.js's own law; noise is null", () => {
        assert.equal(assetKind("src/studio/components/button/styles.css.js"), "css")
        assert.equal(assetKind("src/studio/components/button/template.js"), "template")
        assert.equal(assetKind("src/studio/components/button/index.js"), "js")
        assert.equal(assetKind("apps/starter/hooks.js"), "js")
        assert.equal(assetKind("src/studio/studio.css"), "css")
        assert.equal(assetKind("notes.md"), null)
        assert.equal(assetKind(".git/HEAD"), null)
        assert.equal(assetKind("src/.hidden/x.js"), null)
    })

    Test.it("HMR-02 the watcher debounces a burst into one change and stop() stops it", async () => {
        const dir = mkdtempSync(join(tmpdir(), "nexus-watch-"))
        const seen = []
        const w = createWatcher({ dirs: [dir], onChange: (c) => seen.push(c), debounceMs: 40 })
        const file = join(dir, "template.js")
        writeFileSync(file, "export default 1")
        writeFileSync(file, "export default 2")
        writeFileSync(file, "export default 3")
        await new Promise((r) => setTimeout(r, 300))
        const mine = seen.filter((c) => c.path.endsWith("template.js"))
        assert.equal(mine.length, 1) // burst collapsed
        assert.equal(mine[0].asset, "template")
        assert.truthy(mine[0].timestamp > 0)
        w.stop()
        writeFileSync(file, "export default 4")
        await new Promise((r) => setTimeout(r, 200))
        assert.equal(seen.filter((c) => c.path.endsWith("template.js")).length, 1) // stopped means stopped
        rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("HMR-03 devMessage: framework hits become servable /_nexus hmr paths; app hits become reload; unknown roots emit nothing", () => {
        const env = { nexusRoot: "C:\\nx", appsDir: "C:\\inst\\apps" }
        const hit = (dir, path) => devMessage({ dir, path, asset: "template", timestamp: 5 }, env)
        assert.deepEqual(hit("C:\\nx\\src\\studio", "components/x/template.js"), { type: "hmr", path: "/_nexus/src/studio/components/x/template.js", asset: "template", timestamp: 5 })
        assert.deepEqual(hit("C:\\nx\\src\\core", "UI.js"), { type: "hmr", path: "/_nexus/src/core/UI.js", asset: "template", timestamp: 5 })
        assert.equal(hit("C:\\inst\\apps", "starter/probe/template.js"), "reload")
        assert.equal(hit("C:\\elsewhere", "x.js"), null)
    })
})
