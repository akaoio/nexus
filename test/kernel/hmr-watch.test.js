/**
 * The dev file watcher's dispatch law (HMR-JSON-*) — NODE ONLY, deliberately.
 *
 * These live apart from hmr.test.js because that file is loaded by
 * test/browser/page.html, and `src/core/HMR/watch.js` statically imports `fs`.
 * Importing it there took the whole browser suite down with "timed out waiting
 * for the page verdict" — the same class of mistake VND-07 pins one directory
 * over, and a reminder that "which runner loads this file" is part of a test
 * file's contract.
 */

import Test, { assert } from "../../src/core/Test.js"
import { assetKind, devMessage } from "../../src/core/HMR/watch.js"

Test.describe("Watcher asset kinds — the format the Studio writes (HMR-JSON)", () => {
    Test.it("HMR-JSON01 a .json change is watched, and is DATA rather than a swappable module", () => {
        // Model schemas are .json — the format the Studio itself writes — and
        // assetKind returned null for them, so a model file appearing in apps/
        // was the one change the watcher ignored completely. `nexus dev` did
        // not see a hand-added entity until it was restarted, while the same
        // entity added through the Studio worked, because that path calls
        // reloadInstance() explicitly. The two disagreed about what "hot
        // reload" meant depending on who wrote the file.
        assert.equal(assetKind("starter/models/gadget.json"), "data")
        assert.equal(assetKind("nexus.config.json"), "data")
        // Not "js": JSON is data, not a module to hot-swap.
        assert.notEqual(assetKind("a.json"), "js")
        assert.equal(assetKind("a.js"), "js")
        assert.equal(assetKind("a.css"), "css")
        assert.equal(assetKind(".hidden/a.json"), null, "dotfiles stay ignored")
    })

    Test.it("HMR-JSON02 a data change under the framework dirs is a RELOAD, never a module swap", () => {
        const at = (dir, path, asset) => devMessage({ dir, path, asset, timestamp: 1 }, { nexusRoot: "/n", appsDir: "/i/apps" })
        assert.equal(at("/n/src/studio", "x.json", "data"), "reload", "you cannot hot-swap JSON as a module")
        assert.equal(at("/i/apps", "starter/models/gadget.json", "data"), "reload")
        assert.equal(at("/n/src/studio", "x.js", "js").type, "hmr", "modules still swap")
    })
})
