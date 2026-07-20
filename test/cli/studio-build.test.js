/**
 * `nexus studio build` conformance — STB-* clauses.
 *
 * The Studio reaches the browser in dev through /_nexus/*, a route that serves
 * ANY file under src/ and vendor/. `nexus start` deliberately has no such
 * route (START-03 pins that omission as a security boundary), so production
 * cannot serve the Studio by adding one. Instead the build walks the browser
 * entry point's import graph and copies ONLY what it reaches into the
 * instance's own public/studio/, which the existing static route already
 * serves. These clauses are the contract: the graph stays inside the package
 * and never drags server-side code along (STB-01), and the tree it emits
 * actually resolves once the dev route is gone (STB-02).
 */

import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, statSync } from "fs"
import { tmpdir } from "os"
import { join, dirname, resolve } from "path"
import { fileURLToPath } from "url"
import Test, { assert } from "../../src/core/Test.js"
import { collectModules, buildStudio } from "../../src/cli/commands/studio.js"

const NEXUS_ROOT = fileURLToPath(new URL("../../", import.meta.url))

/** Every .js file in a built tree, recursively. */
function* walkJs(dir) {
    for (const name of readdirSync(dir)) {
        const path = join(dir, name)
        if (statSync(path).isDirectory()) yield* walkJs(path)
        else if (path.endsWith(".js")) yield path
    }
}

/**
 * The specifiers in a module. A regex over `from "…"` / `import("…")` — this
 * is a BUILD CHECK over our own source, not a JavaScript parser: it is allowed
 * to be approximate because the only thing it gates is "does this file exist".
 *
 * Comment lines are skipped for one concrete reason: the vendored zen bundle
 * DOCUMENTS its API in prose (`// import bridge from "./crypto.js"`) and that
 * file never exists — it is a comment, not an import.
 */
function specifiersIn(source) {
    const found = []
    const inComment = (index) => {
        const line = source.slice(source.lastIndexOf("\n", index) + 1, index).trimStart()
        return line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")
    }
    for (const re of [/(?<!["'\w])from\s*["']([^"'\n]+)["']/g, /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g]) {
        let match
        while ((match = re.exec(source))) if (!inComment(match.index)) found.push(match[1])
    }
    return found
}

Test.describe("Studio build — nexus studio build (STB-*)", () => {
    Test.it("STB-01 collectModules follows the import graph and stays inside the package", () => {
        const files = collectModules(new URL("../../src/studio/app.js", import.meta.url))
        assert.truthy(files.some((f) => f.endsWith("src/studio/app.js")))
        assert.truthy(files.some((f) => f.includes("src/studio/components/")))
        assert.truthy(
            files.some((f) => f.includes("src/core/")),
            "kernel modules the Studio imports come along"
        )
        for (const f of files) assert.truthy(f.includes("/src/") || f.includes("/vendor/"), `${f} is inside the package`)
        assert.equal(
            files.some((f) => f.includes("/cli/") || f.includes("/HTTP/")),
            false,
            "server-side code never ships to a browser"
        )
    })

    Test.it("STB-02 the built tree resolves: every specifier points at a file that exists in the output", async () => {
        const out = mkdtempSync(join(tmpdir(), "nexus-studio-"))
        await buildStudio({ root: NEXUS_ROOT, out })
        assert.truthy(existsSync(join(out, "index.html")))
        // walk every .js in the output and resolve each relative specifier
        for (const file of walkJs(out)) {
            for (const spec of specifiersIn(readFileSync(file, "utf8"))) {
                if (!spec.startsWith(".")) continue
                assert.truthy(existsSync(resolve(dirname(file), spec)), `${file} → ${spec}`)
            }
        }
        assert.equal(readFileSync(join(out, "index.html"), "utf8").includes("_dev"), false, "no dev bootstrap in a built shell")
        rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
})
