/**
 * Vendor Kysely into vendor/kysely/ — pinned, verified, reproducible.
 *
 * Per ARCHITECTURE.md N2 (vendored data-plane dependencies) and risk #4
 * (follow upstream security fixes via a diffable sync script):
 *
 *   node script/vendor-kysely.js            # re-sync the pinned version
 *   node script/vendor-kysely.js 0.30.0     # bump the pin (review the diff!)
 *
 * Zero dependencies: fetch + zlib gunzip + a minimal tar reader. The npm
 * registry integrity (sha512) is verified before anything is written.
 * Kysely ≥0.28 is ESM-only with a flat dist/ — the .js files (plus LICENSE)
 * are vendored; .d.ts and maps are skipped. The repo root package.json is
 * { "type": "module" }, so vendor/kysely/index.js imports directly.
 */

import { createHash } from "crypto"
import { gunzipSync } from "zlib"
import { mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from "fs"
import { join, dirname } from "path"

const ROOT = new URL("..", import.meta.url).pathname
const TARGET = join(ROOT, "vendor", "kysely")
const PIN_FILE = join(TARGET, "VENDOR.json")

const requested = process.argv[2] || (existsSync(PIN_FILE) ? JSON.parse(readFileSync(PIN_FILE, "utf8")).version : null)
if (!requested) {
    console.error("Usage: node script/vendor-kysely.js <version>  (no existing pin found)")
    process.exit(2)
}

console.log(`Vendoring kysely@${requested} …`)

// ── Registry metadata + integrity ────────────────────────────────────────────
const meta = await (await fetch(`https://registry.npmjs.org/kysely/${requested}`)).json()
if (!meta?.dist?.tarball) {
    console.error(`Version not found on the registry: ${requested}`)
    process.exit(1)
}
if (Object.keys(meta.dependencies ?? {}).length > 0) {
    console.error("Refusing: this Kysely version declares runtime dependencies — violates N2")
    process.exit(1)
}

const tarball = new Uint8Array(await (await fetch(meta.dist.tarball)).arrayBuffer())
const sha512 = createHash("sha512").update(tarball).digest("base64")
const expected = meta.dist.integrity.replace(/^sha512-/, "")
if (sha512 !== expected) {
    console.error("Integrity check FAILED — tarball does not match the registry signature")
    process.exit(1)
}
console.log(`  integrity ok (sha512-${sha512.slice(0, 16)}…)`)

// ── Minimal tar reader (ustar; pax path overrides honoured) ─────────────────
function* entries(buffer) {
    let offset = 0
    let paxPath = null
    while (offset + 512 <= buffer.length) {
        const header = buffer.subarray(offset, offset + 512)
        if (header.every((b) => b === 0)) break
        const str = (from, len) => {
            const raw = header.subarray(from, from + len)
            const end = raw.indexOf(0)
            return new TextDecoder().decode(end === -1 ? raw : raw.subarray(0, end))
        }
        const size = parseInt(str(124, 12).trim() || "0", 8)
        const type = String.fromCharCode(header[156] || 48)
        const prefix = str(345, 155)
        let name = (prefix ? prefix + "/" : "") + str(0, 100)
        const body = buffer.subarray(offset + 512, offset + 512 + size)
        offset += 512 + Math.ceil(size / 512) * 512

        if (type === "x") {
            // pax extended header: records like "NN path=value\n"
            const text = new TextDecoder().decode(body)
            const match = text.match(/\d+ path=([^\n]+)\n/)
            if (match) paxPath = match[1]
            continue
        }
        if (paxPath) {
            name = paxPath
            paxPath = null
        }
        if (type === "0" || type === "\0") yield { name, body }
    }
}

// ── Extract dist/esm → vendor/kysely/ ────────────────────────────────────────
rmSync(TARGET, { recursive: true, force: true })
mkdirSync(TARGET, { recursive: true })

const files = []
for (const { name, body } of entries(gunzipSync(tarball))) {
    let relative = null
    if (name.startsWith("package/dist/") && name.endsWith(".js") && !name.endsWith(".d.js"))
        relative = name.slice("package/dist/".length)
    else if (name === "package/LICENSE") relative = "LICENSE"
    if (!relative) continue
    const path = join(TARGET, relative)
    mkdirSync(dirname(path), { recursive: true })
    writeFileSync(path, body)
    files.push(relative)
}

writeFileSync(
    PIN_FILE,
    JSON.stringify(
        {
            name: "kysely",
            version: requested,
            tarball: meta.dist.tarball,
            integrity: meta.dist.integrity,
            license: meta.license,
            files: files.length,
            vendoredAt: new Date().toISOString().slice(0, 10),
            note: "Vendored ESM build only. Re-sync: node script/vendor-kysely.js — review the git diff before committing (ARCHITECTURE.md risk #4)."
        },
        null,
        4
    ) + "\n"
)

console.log(`  ${files.length} files → vendor/kysely/`)
console.log(`  pinned in VENDOR.json — review the git diff before committing`)
