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
import { spawnSync } from "child_process"
import Test, { assert } from "../../src/core/Test.js"
import { collectModules, buildStudio, stripComments } from "../../src/cli/commands/studio.js"

const NEXUS_ROOT = fileURLToPath(new URL("../../", import.meta.url))
const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

/** Spawn `nexus studio build [args]` in a scratch instance, --json. */
function runBuild(instance, args = []) {
    const result = spawnSync(process.execPath, [BIN, "studio", "build", "--json", ...args], { cwd: instance, encoding: "utf8" })
    return { code: result.status, data: JSON.parse(result.stdout || result.stderr || "{}") }
}

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
 * Comments are skipped for one concrete reason: the vendored zen bundle
 * DOCUMENTS its API in prose (`// import bridge from "./crypto.js"`) and that
 * file never exists — it is a comment, not an import. This used to have its
 * own local `inComment(index)` — the same line-prefix check ("does the text
 * before this index merely START WITH `//`/`*`/`/*`, never verifying a
 * same-line block comment actually CLOSES") that stripComments replaced
 * everywhere else in this file. It was the last copy of that bug. Routed
 * through the shared `stripComments` (imported above) instead, so there is
 * exactly one comment implementation, not two.
 */
function specifiersIn(source) {
    const found = []
    const stripped = stripComments(source)
    for (const re of [/(?<!["'\w])from\s*["']([^"'\n]+)["']/g, /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g]) {
        let match
        while ((match = re.exec(stripped))) found.push(match[1])
    }
    return found
}

// stripComments (imported above from src/cli/commands/studio.js) is the
// SINGLE shared implementation STB-01, STB-03 and collectModules all use to
// tell real code apart from a comment — see its doc comment there for why a
// character-scanning state machine replaced the line-prefix check
// (`inComment`) that used to live separately in each of these call sites and
// could be bypassed by a real import preceded by an inline block comment on
// the same line (`/* c */ import x from "./y.js"`).

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
            const STATIC_EDGES = [/(?<!["'\w])from\s*["']([^"'\n]+)["']/g, /(?<!["'\w])import\s+["']([^"'\n]+)["']/g]
            for (const file of walkJs(out)) {
                const src = stripComments(readFileSync(file, "utf8"))
                for (const re of STATIC_EDGES) {
                    re.lastIndex = 0
                    let match
                    while ((match = re.exec(src))) assert.truthy(!BUILTIN.test(match[1]), `${file} statically imports a Node built-in ("${match[1]}")`)
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
        const STATIC_EDGES = [/(?<!["'\w])from\s*["']([^"'\n]+)["']/g, /(?<!["'\w])import\s+["']([^"'\n]+)["']/g]
        for (const f of staticGraph) {
            const src = stripComments(readFileSync(f, "utf8"))
            for (const re of STATIC_EDGES) {
                re.lastIndex = 0
                let match
                while ((match = re.exec(src))) assert.truthy(!BUILTIN.test(match[1]), `${f} statically imports a Node built-in ("${match[1]}")`)
            }
        }
    })

    Test.it("STB-03a the comment-aware scan itself can't be bypassed: a `/* c */`-prefixed import is still caught, a real string literal is still left alone", () => {
        // Pins the exact bypass a reviewer found: STB-01/STB-03 used to skip a
        // match whenever the TEXT BEFORE IT on the same line merely STARTED
        // WITH `//`/`*`/`/*`, never checking whether a same-line block comment
        // actually closed before the match. So `/* c */ import … from "path"`
        // read as commented out and slipped through both clauses. This fixture
        // asserts stripComments() gets both halves of that right: the live
        // import survives stripping (and so is still visible to a BUILTIN
        // scan), while a string literal that merely LOOKS comment-shaped
        // (`"http://…"`, and one holding a literal `/* */` sequence) survives
        // completely untouched rather than being eaten as a comment.
        const fixture = ['/* c */ import { join } from "path"', 'const u = "http://x"', 'const weird = "a /* not a comment */ b"'].join("\n")
        const stripped = stripComments(fixture)
        const STATIC_EDGES = [/(?<!["'\w])from\s*["']([^"'\n]+)["']/g, /(?<!["'\w])import\s+["']([^"'\n]+)["']/g]
        const specifiers = []
        for (const re of STATIC_EDGES) {
            re.lastIndex = 0
            let match
            while ((match = re.exec(stripped))) specifiers.push(match[1])
        }
        assert.truthy(specifiers.includes("path"), "the inline-comment-prefixed import must still be found, not read as commented out")
        assert.truthy(stripped.includes('"http://x"'), "a string literal must survive stripping untouched")
        assert.truthy(stripped.includes('"a /* not a comment */ b"'), "a comment-shaped sequence INSIDE a string must not be stripped")
    })

    Test.it("STB-03b stripComments tracks template-literal `${}` nesting: a `//` inside a nested template's expression is NOT a line comment", () => {
        // A second, DIFFERENT dormant bug a reviewer found in the same helper:
        // the scanner treated every backtick as a naive open/close toggle and
        // never tracked `${…}` expression context. So in
        // `` `outer ${fn(`a // b`)}` `` it believed the OUTER template closed
        // at the FIRST backtick after `fn(` (misreading the nested template's
        // opening backtick as the outer template's closer), which put the
        // scanner back in "code" mode one backtick too early — right in the
        // middle of `a // b`, whose `//` then read as a real line comment and
        // ate everything after it to end-of-file, silently deleting a real
        // import that followed on the same line. This fixture is the
        // reviewer's exact repro: assert the import specifier SURVIVES.
        const fixture = 'const x = `outer ${fn(`a // b`)}`; import { readFileSync } from "fs"'
        const stripped = stripComments(fixture)
        assert.truthy(stripped.includes('import { readFileSync } from "fs"'), "the real import after the nested template must survive — its text must not be eaten as a line comment")
        const STATIC_EDGES = [/(?<!["'\w])from\s*["']([^"'\n]+)["']/g, /(?<!["'\w])import\s+["']([^"'\n]+)["']/g]
        const specifiers = []
        for (const re of STATIC_EDGES) {
            re.lastIndex = 0
            let match
            while ((match = re.exec(stripped))) specifiers.push(match[1])
        }
        assert.truthy(specifiers.includes("fs"), "the import's specifier must still be matchable after stripping")
    })

    Test.it("STB-04 a static build bakes mode:\"production\" into the boot payload (the dev-only surfaces hide themselves)", async () => {
        const out = mkdtempSync(join(tmpdir(), "nexus-studio-"))
        await buildStudio({ root: NEXUS_ROOT, out })
        const html = readFileSync(join(out, "index.html"), "utf8")
        const boot = JSON.parse(html.match(/<script[^>]*id="nx-boot"[^>]*>([^<]*)<\/script>/)[1])
        assert.equal(boot.mode, "production", "a built shell is production")
        rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("STB-OUT the CLI guard accepts only the ONE --out location `nexus start` actually serves (public/studio); anything else is refused loudly, not silently 404'd later", () => {
        // buildStudio() itself takes any `out` (the STB-* clauses above drive
        // it directly with a tmpdir) — this guard lives in the `studio()` CLI
        // handler. `nexus start` (start.js) hardcodes public/studio/index.html
        // as the only shell it ever serves, so `--out public/admin` used to
        // SUCCEED (it was merely "inside public/") and bake a shell with
        // /admin/ asset refs that nothing serves — a loud success followed by
        // every Studio route 404ing with no explanation. This pins the fix:
        // the guard now accepts exactly <instance>/public/studio.
        const scratch = mkdtempSync(join(tmpdir(), "nexus-studio-out-"))
        try {
            spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
            const instance = join(scratch, "shop")

            // default (no --out): unchanged behavior — resolves to public/studio and succeeds
            const def = runBuild(instance)
            assert.equal(def.code, 0, JSON.stringify(def.data))
            assert.equal(def.data.ok, true)
            assert.truthy(existsSync(join(instance, "public", "studio", "index.html")))
            const html = readFileSync(join(instance, "public", "studio", "index.html"), "utf8")
            assert.truthy(html.includes("/studio/"), `the default build's shell must reference its /studio/ mount; got ${html.slice(0, 200)}`)

            // --out public/studio explicitly: the one mount nexus start reads — same as default
            const explicit = runBuild(instance, ["--out", "public/studio"])
            assert.equal(explicit.code, 0, JSON.stringify(explicit.data))
            assert.equal(explicit.data.ok, true)

            // --out public/admin: inside public/, but NOT the mount `nexus start`
            // serves — must be refused loudly rather than bake a dead shell
            const admin = runBuild(instance, ["--out", "public/admin"])
            assert.equal(admin.code, 2, "an --out nexus start cannot serve must exit non-zero")
            assert.equal(admin.data.ok, false)
            assert.equal(admin.data.code, "E_STUDIO_OUT")
            assert.equal(existsSync(join(instance, "public", "admin")), false, "the refused build must not have written anything")

            // --out ../evil: outside public/ entirely — still refused, unchanged
            const evil = runBuild(instance, ["--out", "../evil"])
            assert.equal(evil.code, 2)
            assert.equal(evil.data.ok, false)
            assert.equal(evil.data.code, "E_STUDIO_OUT")
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })
})
