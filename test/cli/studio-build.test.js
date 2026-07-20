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
    Test.it("STB-01 the build stays inside the package and ships nothing that statically imports a Node built-in", async () => {
        const files = collectModules(new URL("../../src/studio/app.js", import.meta.url))
        assert.truthy(files.some((f) => f.endsWith("src/studio/app.js")))
        assert.truthy(files.some((f) => f.includes("src/studio/components/")))
        assert.truthy(
            files.some((f) => f.includes("src/core/")),
            "kernel modules the Studio imports come along"
        )
        for (const f of files) assert.truthy(f.includes("/src/") || f.includes("/vendor/"), `${f} is inside the package`)

        // Widened (carry-over from Task 5's review): the narrow "/cli/ or
        // /HTTP/" substring check above stayed green while whole modules
        // changed shape around it — a path-name check, not a content check.
        // Task 6b's lazy split made core/Data's browser-safe tier
        // (adapters/ddl/kysely/migrate.js) provably clean of Node built-ins,
        // so state the real invariant instead of implying a stronger one:
        // NO file in the copy-build's ACTUAL BUILT OUTPUT has a STATIC
        // top-level import of a Node built-in — checked against the built
        // tree itself (not just the source graph), so a future rewrite step
        // cannot reintroduce one silently. Some modules (OPFS/Thread/the
        // crypto worker/vendored zen) DO ship, and DO reference a Node
        // built-in — but only inside a guarded DYNAMIC import() (e.g.
        // FS/shared.js's `if (NODE) fs = await import("fs")`), which a
        // browser boot never evaluates. That is the honest state: shipped
        // but never eagerly loaded, not absent — asserted explicitly below
        // rather than left to the narrow check's unstated implication.
        const out = mkdtempSync(join(tmpdir(), "nexus-studio-"))
        try {
            await buildStudio({ root: NEXUS_ROOT, out })
            const BUILTIN = /^(module|url|path|fs|crypto|os|child_process|node:(?!sqlite))/
            const inComment = (src, i) => {
                const line = src.slice(src.lastIndexOf("\n", i) + 1, i).trimStart()
                return line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")
            }
            const STATIC_EDGES = [/(?<!["'\w])from\s*["']([^"'\n]+)["']/g, /(?<!["'\w])import\s+["']([^"'\n]+)["']/g]
            for (const file of walkJs(out)) {
                const src = readFileSync(file, "utf8")
                for (const re of STATIC_EDGES) {
                    re.lastIndex = 0
                    let match
                    while ((match = re.exec(src)))
                        if (!inComment(src, match.index)) assert.equal(BUILTIN.test(match[1]), false, `${file} statically imports a Node built-in ("${match[1]}")`)
                }
            }
            // Prove the invariant above is "clean by construction", not
            // "clean because the reference is missing": the guarded fallback
            // that DOES mention a Node built-in (inside a dynamic import())
            // is genuinely present in the shipped tree.
            assert.truthy(existsSync(join(out, "src", "core", "FS", "shared.js")), "the guarded Node fs fallback still ships — dynamic-only, never a static import")
        } finally {
            rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
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

    Test.it("STB-03 the built Studio's static boot graph never reaches a Node built-in — it boots in a browser", () => {
        // The browser evaluates the STATIC graph eagerly, so a `from "node:fs"`
        // (or side-effect `import "node:fs"`) anywhere in it breaks boot. We scan
        // exactly those two STATIC edges — never dynamic `import()`, which the
        // kernel uses as an environment-GUARDED lazy fallback the browser never
        // runs (e.g. FS/shared.js's `if (NODE) fs = await import("fs")`, browser-
        // safe by construction). Comment lines are skipped: vendored kysely and
        // core/Data DOCUMENT their Node usage in JSDoc prose (`* import path from
        // 'node:path'`), which is not an import — the brief's whole-file regex
        // would false-RED on it, which is why the rest of the STB machinery is
        // comment-aware too. node:sqlite is allowed by the contract, but Task 6b
        // removed it from the boot graph entirely — nothing here reaches it.
        const staticGraph = collectModules(new URL("../../src/studio/app.js", import.meta.url), { staticOnly: true })
        const BUILTIN = /^(module|url|path|fs|crypto|os|child_process|node:(?!sqlite))/
        const inComment = (src, i) => {
            const line = src.slice(src.lastIndexOf("\n", i) + 1, i).trimStart()
            return line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")
        }
        const STATIC_EDGES = [/(?<!["'\w])from\s*["']([^"'\n]+)["']/g, /(?<!["'\w])import\s+["']([^"'\n]+)["']/g]
        for (const f of staticGraph) {
            const src = readFileSync(f, "utf8")
            for (const re of STATIC_EDGES) {
                re.lastIndex = 0
                let match
                while ((match = re.exec(src)))
                    if (!inComment(src, match.index))
                        assert.equal(BUILTIN.test(match[1]), false, `${f} statically imports a Node built-in ("${match[1]}")`)
            }
        }
    })

    Test.it("STB-04 a static build bakes mode:\"production\" into the boot payload (the dev-only surfaces hide themselves)", async () => {
        const out = mkdtempSync(join(tmpdir(), "nexus-studio-"))
        await buildStudio({ root: NEXUS_ROOT, out })
        const html = readFileSync(join(out, "index.html"), "utf8")
        const boot = JSON.parse(html.match(/<script[^>]*id="nx-boot"[^>]*>([^<]*)<\/script>/)[1])
        assert.equal(boot.mode, "production", "a built shell is production")
        rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
})
