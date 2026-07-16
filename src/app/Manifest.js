/**
 * App Manifest v1 — the third frozen public format of N4 (ARCHITECTURE.md
 * §8.1/§8.4). A manifest declares an app and its compatibility contract:
 *
 *   { manifestVersion: 1, name, version, engines?: { nexus: "<range>" },
 *     description? }
 *
 * §8.4.2 made real: `engines.nexus` is a semver range and the core REFUSES
 * to load an app outside it — refusal at load time beats crashing at run
 * time. The range grammar is deliberately small and closed (frozen format):
 * space-separated comparators (>= > <= < =), caret (^x.y.z), or "*".
 */

const NAME_RE = /^[a-z][a-z0-9_-]*$/
const SEMVER_RE = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/
const MANIFEST_KEYS = ["manifestVersion", "name", "version", "engines", "description"]

export const MANIFEST_VERSION = 1

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)
const clone = (x) => JSON.parse(JSON.stringify(x))

const parse = (version) => {
    const match = SEMVER_RE.exec(version)
    return match ? [Number(match[1]), Number(match[2]), Number(match[3])] : null
}

const compare = (a, b) => {
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] < b[i] ? -1 : 1
    return 0
}

/**
 * Does a version satisfy a range? Grammar: "*" | "^x.y.z" | space-separated
 * comparators ">=x[.y[.z]]" ">x" "<=x" "<x" "=x.y.z" | bare "x.y.z" (exact).
 * Unknown grammar throws E_RANGE — never silently permissive.
 */
export function satisfies(version, range) {
    const v = parse(version)
    if (!v) throw err("E_SEMVER", `not a version: "${version}"`)
    const trimmed = String(range).trim()
    if (trimmed === "*") return true

    if (trimmed.startsWith("^")) {
        const base = parse(trimmed.slice(1))
        if (!base) throw err("E_RANGE", `bad caret range: "${range}"`)
        const upper = base[0] > 0 ? [base[0] + 1, 0, 0] : [0, base[1] + 1, 0]
        return compare(v, base) >= 0 && compare(v, upper) < 0
    }

    const pad = (text) => {
        const parts = text.split(".").map(Number)
        if (parts.some((n) => !Number.isInteger(n) || n < 0) || parts.length === 0 || parts.length > 3)
            throw err("E_RANGE", `bad version in range: "${text}"`)
        while (parts.length < 3) parts.push(0)
        return parts
    }

    for (const clause of trimmed.split(/\s+/)) {
        const match = /^(>=|<=|>|<|=)?(.+)$/.exec(clause)
        const op = match[1] ?? "="
        const bound = pad(match[2])
        const cmp = compare(v, bound)
        if (op === ">=" && cmp < 0) return false
        if (op === ">" && cmp <= 0) return false
        if (op === "<=" && cmp > 0) return false
        if (op === "<" && cmp >= 0) return false
        if (op === "=" && cmp !== 0) return false
    }
    return true
}

/**
 * Validate a v1 manifest. Never throws.
 * @returns {{valid: true} | {valid: false, errors: Array<{code, path}>}}
 */
export function validate(manifest) {
    if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest))
        return { valid: false, errors: [{ code: "E_MANIFEST", path: "" }] }
    const errors = []
    if (!("manifestVersion" in manifest)) errors.push({ code: "E_VERSION", path: "/manifestVersion" })
    else if (manifest.manifestVersion !== MANIFEST_VERSION)
        errors.push({ code: "E_VERSION_UNKNOWN", path: "/manifestVersion" })
    for (const key of Object.keys(manifest))
        if (!MANIFEST_KEYS.includes(key)) errors.push({ code: "E_MANIFEST_KEYS", path: `/${key}` })
    if (typeof manifest.name !== "string" || !NAME_RE.test(manifest.name))
        errors.push({ code: "E_NAME", path: "/name" })
    if (typeof manifest.version !== "string" || !parse(manifest.version))
        errors.push({ code: "E_SEMVER", path: "/version" })
    if ("engines" in manifest) {
        const engines = manifest.engines
        if (engines === null || typeof engines !== "object" || Array.isArray(engines) || typeof engines.nexus !== "string")
            errors.push({ code: "E_ENGINES", path: "/engines" })
        else
            try {
                satisfies("1.0.0", engines.nexus) // grammar check only
            } catch {
                errors.push({ code: "E_RANGE", path: "/engines/nexus" })
            }
    }
    if ("description" in manifest && typeof manifest.description !== "string")
        errors.push({ code: "E_DESCRIPTION", path: "/description" })
    return errors.length ? { valid: false, errors } : { valid: true }
}

/** §8.4.2 — may this core load this app? engines absent = compatible. */
export function compatible(manifest, coreVersion) {
    if (!("engines" in manifest) || !manifest.engines?.nexus) return true
    return satisfies(coreVersion, manifest.engines.nexus)
}

/** N4 gate: v1 is the only version — identity today, loud otherwise. */
export function upgrade(manifest) {
    if (manifest?.manifestVersion === MANIFEST_VERSION) return clone(manifest)
    throw err("E_VERSION_UNKNOWN", `cannot upgrade manifestVersion ${manifest?.manifestVersion}`)
}

export default { MANIFEST_VERSION, validate, satisfies, compatible, upgrade }
