/**
 * nexus studio build — the Studio as static assets.
 *
 *   nexus studio build [--out public/studio]
 *
 * In dev the Studio reaches the browser through /_nexus/*, a route that serves
 * ANY file under src/ and vendor/. `nexus start` deliberately has no such
 * route, and that omission IS a security boundary (START-03 pins it). So the
 * Studio cannot be made to work in production by adding a module-serving
 * route. Instead this command walks the browser entry point's import graph,
 * copies ONLY the files it actually reaches into the instance's own
 * public/studio/, and lets the existing static route serve them — zero new
 * server surface, and nothing out of the framework's src/ is ever served by
 * `nexus start` itself.
 *
 * Layout is preserved under the output root (src/… and vendor/… as they sit in
 * the package), so every RELATIVE specifier keeps working unchanged and no
 * bundler is needed (rule N2: zero dependencies). Only the root-absolute
 * /_nexus/… specifiers are rewritten.
 */

import { existsSync, statSync, readFileSync, writeFileSync, copyFileSync, mkdirSync, renameSync, rmSync, readdirSync } from "fs"
import { join, resolve, relative, dirname, sep } from "path"
import { fileURLToPath } from "url"
import { randomBytes } from "crypto"
import { spawnSync } from "child_process"
import { tmpdir } from "os"

const NEXUS_ROOT = fileURLToPath(new URL("../../../", import.meta.url))

/** The browser entry point — the one module the shell loads. */
const ENTRY = "src/studio/app.js"

/**
 * Assets the Studio fetches at RUNTIME rather than importing, so no import
 * graph can reach them. They are enumerated because they are referenced by
 * URL strings in markup the components emit (checked by the no-/_nexus/
 * invariant at the end of a build).
 */
const RUNTIME_ASSETS = ["src/studio/images/brand.svg", "vendor/bootstrap-icons/bootstrap-icons.svg"]

/**
 * Specifier forms. These regexes are a BUILD-TIME SCAN OVER OUR OWN SOURCE —
 * NOT a JavaScript parser. That is deliberate and sufficient: the source they
 * read is the repo's, every form below was verified against it, and a form
 * that resolved to nothing would fail the build loudly rather than silently
 * ship a Studio that 404s. The `new URL(…, import.meta.url)` form is not
 * decoration: it is how the Studio loads its crypto WORKER
 * (src/studio/threads/crypto.js) and how the vendored zen loads its .wasm —
 * a scan of only `from`/`import()` would silently miss all three.
 */
const SPECIFIER_PATTERNS = [
    /(?<!["'\w])from\s*["']([^"'\n]+)["']/g, // import … from "x" · export … from "x"
    /(?<!["'\w])import\s+["']([^"'\n]+)["']/g, // side-effect import "x"
    /\bimport\s*\(\s*["']([^"'\n]+)["']\s*\)/g, // dynamic import("x")
    /new\s+URL\s*\(\s*["']([^"'\n]+)["']\s*,\s*import\.meta\.url\s*\)/g // worker + wasm assets
]

/**
 * Specifier forms we can see but cannot resolve statically (a template literal
 * where a path should be). Reported LOUDLY: a missed module is a Studio that
 * 404s in production while the build claims success.
 */
const NON_STATIC_PATTERNS = [/\bimport\s*\(\s*`/, /new\s+URL\s*\(\s*`/]

/** Absolute path with forward slashes — the same string shape on Windows and POSIX. */
const posix = (path) => path.split(sep).join("/")

/** A relative specifier from one directory to one file, always URL-shaped. */
function specifierTo(fromDir, target) {
    const rel = posix(relative(fromDir, target))
    return rel.startsWith(".") ? rel : "./" + rel
}

/**
 * Is this offset inside a comment line? Only used to decide whether a
 * specifier that resolves to a MISSING file is a real broken import or just
 * prose (the vendored zen documents its API in `// import x from "./y"`
 * comments). Erring here can only ever produce a loud false failure, never a
 * silent miss — the scan itself always reads the raw source.
 */
function isCommentLine(source, index) {
    const start = source.lastIndexOf("\n", index) + 1
    const line = source.slice(start, index).trimStart()
    return line.startsWith("//") || line.startsWith("*") || line.startsWith("/*")
}

/** Resolve a specifier to a package file, or null if it is not ours to ship. */
function resolveSpecifier(spec, fromFile, root) {
    if (spec.startsWith("/_nexus/")) return resolve(root, "." + spec.slice("/_nexus".length))
    if (spec.startsWith(".")) return resolve(dirname(fromFile), spec)
    return null // bare ("kysely", "node:fs") or origin-absolute: not a package file
}

/**
 * Walk the import graph from an entry module, returning every package file it
 * reaches — absolute, forward-slashed, sorted. Stops at anything outside the
 * package. Throws on a specifier that resolves inside the package but points
 * at no file: that is a broken import, and shipping it would mean a Studio
 * that fails only once it is in front of a user.
 */
export function collectModules(entry, { root = NEXUS_ROOT } = {}) {
    const entryPath = entry instanceof URL || String(entry).startsWith("file:") ? fileURLToPath(entry) : resolve(root, String(entry))
    const seen = new Set()
    const broken = []
    const nonStatic = []

    const walk = (file) => {
        if (seen.has(file)) return
        seen.add(file)
        if (!/\.(js|mjs)$/.test(file)) return // assets are leaves
        const source = readFileSync(file, "utf8")

        for (const re of NON_STATIC_PATTERNS) if (re.test(source)) nonStatic.push(posix(relative(root, file)))

        for (const re of SPECIFIER_PATTERNS) {
            re.lastIndex = 0
            let match
            while ((match = re.exec(source))) {
                const target = resolveSpecifier(match[1], file, root)
                if (!target) continue
                const inside = posix(relative(root, target))
                if (inside.startsWith("..")) continue // outside the package: not ours
                if (!existsSync(target) || !statSync(target).isFile()) {
                    if (!isCommentLine(source, match.index)) broken.push(`${posix(relative(root, file))} → ${match[1]}`)
                    continue
                }
                walk(target)
            }
        }
    }
    walk(entryPath)

    if (broken.length) throw new Error(`Studio build: ${broken.length} import(s) point at no file:\n  ` + broken.join("\n  "))
    // Not fatal — the Studio's only non-static forms are fallbacks it never
    // takes — but never silent: a new one could mean a module that never ships.
    if (nonStatic.length) collectModules.warnings = nonStatic

    return [...seen].map((f) => posix(f)).sort()
}

/**
 * Rewrite a module for the built tree. Relative specifiers already work (the
 * layout is preserved), so only /_nexus/… is touched:
 *
 *  - in specifier position → a plain relative specifier, resolved against the
 *    MODULE's own URL, which is what the browser does for imports;
 *  - anywhere else it is a runtime URL embedded in markup (an <nx-svg
 *    data-src>, an SVG sprite <use href>), which the browser would resolve
 *    against the DOCUMENT, not the module. Those become
 *    `new URL("…", import.meta.url).href` so they stay correct no matter what
 *    path the instance serves public/studio/ from.
 */
function rewriteModule(source, file, outRoot) {
    const dir = dirname(file)
    let output = source

    for (const re of SPECIFIER_PATTERNS) {
        output = output.replace(new RegExp(re.source, "g"), (whole, spec) => {
            if (!spec.startsWith("/_nexus/")) return whole
            const target = resolve(outRoot, "." + spec.slice("/_nexus".length))
            return whole.replace(spec, specifierTo(dir, target))
        })
    }

    // leftovers: runtime URLs, always inside a template literal in this codebase
    output = output.replace(/\/_nexus\/([A-Za-z0-9._/-]+)/g, (_whole, path) => {
        const target = resolve(outRoot, path)
        return "${new URL(" + JSON.stringify(specifierTo(dir, target)) + ", import.meta.url).href}"
    })
    return output
}

/** Syntax-check a rewritten module as ESM — a rewrite must never emit broken JS. */
function checkSyntax(source, label) {
    const probe = join(tmpdir(), `nexus-studio-check-${randomBytes(6).toString("hex")}.mjs`)
    writeFileSync(probe, source)
    const result = spawnSync(process.execPath, ["--check", probe], { encoding: "utf8" })
    rmSync(probe, { force: true })
    if (result.status !== 0) throw new Error(`Studio build: rewriting ${label} produced invalid JavaScript:\n${result.stderr}`)
}

/**
 * Build the Studio into `out`.
 *
 * ATOMIC BY CONSTRUCTION: everything is written to a sibling staging
 * directory. Only once the whole tree is on disk and every invariant holds is
 * the previous output swapped out by rename. Any failure — a broken import, a
 * rewrite that produced invalid JS, a surviving /_nexus/ reference — throws
 * with the staging directory removed and the previous public/studio/ exactly
 * as it was. A half-copied UI is worse than no UI.
 */
export async function buildStudio({ root = NEXUS_ROOT, out, config = {}, schemas = [], meta = {} } = {}) {
    if (!out) throw new Error("Studio build: an output directory is required")
    const outAbs = resolve(out)
    const staging = outAbs + ".building-" + randomBytes(6).toString("hex")

    try {
        const files = collectModules(join(root, ENTRY), { root })
        for (const asset of RUNTIME_ASSETS) {
            const path = join(root, asset)
            if (!existsSync(path)) throw new Error(`Studio build: missing runtime asset ${asset}`)
            if (!files.includes(posix(path))) files.push(posix(path))
        }

        mkdirSync(staging, { recursive: true })
        for (const file of files) {
            const dest = join(staging, relative(root, file))
            mkdirSync(dirname(dest), { recursive: true })
            if (!/\.(js|mjs)$/.test(file)) {
                copyFileSync(file, dest)
                continue
            }
            const source = readFileSync(file, "utf8")
            const rewritten = rewriteModule(source, dest, staging)
            if (rewritten !== source && source.includes("/_nexus/")) checkSyntax(rewritten, posix(relative(root, file)))
            writeFileSync(dest, rewritten)
        }

        // The stylesheet is COMPOSED from the css modules (no build step in
        // dev — the dev server serves the same string). Materialised here so
        // the built shell can link a real file.
        const { pageStyles } = await import("../../studio/css/page.css.js")
        const cssPath = join(staging, "src/studio/studio.css")
        mkdirSync(dirname(cssPath), { recursive: true })
        writeFileSync(cssPath, pageStyles)

        // The shell, with NO dev bootstrap: studioIndex emits none — dev.js is
        // what injects `globalThis._dev` — so a built shell carries none by
        // construction. /_nexus/ → output-root-relative (index.html sits at
        // the root, so the document base and the output root coincide).
        const { studioIndex } = await import("../../studio/layouts/studio/shell.js")
        const html = studioIndex(config, schemas, meta).replaceAll("/_nexus/", "./")
        writeFileSync(join(staging, "index.html"), html)

        // Invariant: nothing in the built tree may still point at the dev-only
        // module route. If anything does, production would 404 it.
        const survivors = []
        const scan = (dir) => {
            for (const name of readdirSync(dir)) {
                const path = join(dir, name)
                if (statSync(path).isDirectory()) scan(path)
                else if (/\.(js|css|html|svg)$/.test(path) && readFileSync(path, "utf8").includes("/_nexus/")) survivors.push(posix(relative(staging, path)))
            }
        }
        scan(staging)
        if (survivors.length) throw new Error(`Studio build: ${survivors.length} file(s) still reference the dev-only /_nexus/ route:\n  ` + survivors.join("\n  "))

        // Commit: swap the staged tree in, keeping the old one until the
        // rename succeeds so a failure here restores rather than destroys.
        mkdirSync(dirname(outAbs), { recursive: true })
        const backup = existsSync(outAbs) ? outAbs + ".previous-" + randomBytes(6).toString("hex") : null
        if (backup) renameSync(outAbs, backup)
        try {
            renameSync(staging, outAbs)
        } catch (error) {
            if (backup) renameSync(backup, outAbs)
            throw error
        }
        if (backup) rmSync(backup, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })

        return { out: outAbs, files: files.length + 2 } // + studio.css + index.html
    } catch (error) {
        rmSync(staging, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        throw error
    }
}

export async function studio(args, flags, out) {
    const sub = args[0]
    if (sub !== "build") {
        out.error(sub ? `Unknown studio subcommand: ${sub}` : "Missing studio subcommand", { code: "E_USAGE" })
        out.hint("Available: build")
        process.exitCode = 2
        return
    }

    const root = process.cwd()
    const target = resolve(root, flags.out === true || !flags.out ? join("public", "studio") : String(flags.out))

    // Boot data is BAKED into the built shell (it is a static file now), so a
    // schema change means a rebuild — said plainly rather than discovered.
    let config = {}
    let schemas = []
    let meta = {}
    if (existsSync(join(root, "nexus.config.json"))) {
        const { loadInstance } = await import("../instance.js")
        const { loadDictionary, mergeDictionaries, coveredLocales } = await import("../../i18n/i18n.js")
        const instance = loadInstance(root)
        config = instance.config
        schemas = instance.schemas
        const fw = loadDictionary(join(NEXUS_ROOT, "src/i18n/dict"))
        const inst = loadDictionary(join(root, "i18n"))
        const dict = mergeDictionaries(fw.dict, inst.dict)
        meta = {
            appName: instance.apps[0]?.dir ?? "app",
            i18n: { dict, names: { ...fw.locales, ...inst.locales }, locales: coveredLocales(dict) }
        }
    }

    const result = await buildStudio({ root: NEXUS_ROOT, out: target, config, schemas, meta })
    out.print(`Studio built → ${relative(root, result.out) || result.out} ${out.dim(`(${result.files} files)`)}`)
    out.hint("`nexus start` serves it from public/ — no framework-source route needed")
    out.emit({ ok: true, out: result.out, files: result.files })
}

export default { studio, buildStudio, collectModules }
