/**
 * What a built Studio was built FROM, and whether that is still true.
 *
 * `nexus studio build` copies the framework's own src/studio/** into an
 * instance's public/studio/ and BAKES the instance's schemas into the shell it
 * emits. Both of those move afterwards, by ordinary means:
 *
 *   - `nexus update` replaces the framework source. It updates the
 *     INSTALLATION the binary belongs to and holds no register of the
 *     instances running against it, so it cannot rebuild them — it can only
 *     invalidate them.
 *   - editing a model in `nexus dev` replaces the schemas, which needs no
 *     update at all.
 *
 * Neither used to be recorded, so a built Studio could serve old code against
 * a new server, and render forms for fields that no longer existed, in
 * silence. A build now writes `build.json`, and this module is the comparison
 * that reads it.
 *
 * Everything here is a function over data — the reporting lives in the
 * commands, so `start`, `doctor` and the build itself all reach one answer
 * instead of three that can disagree.
 */

import { existsSync, readFileSync } from "fs"
import { join } from "path"
import { createHash } from "crypto"
import { spawnSync } from "child_process"

export const STAMP_FILE = "build.json"

/**
 * The framework's identity: its version, and its commit when there IS one.
 *
 * A git install can answer at commit resolution. A tarball or npm install has
 * no checkout to read and answers `null` — which `stalenessOf` then reports as
 * a dimension it could not check, rather than quietly passing.
 */
export function frameworkStamp(root) {
    let version = null
    try {
        version = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version ?? null
    } catch {
        version = null
    }

    let commit = null
    if (existsSync(join(root, ".git"))) {
        const r = spawnSync("git", ["-C", root, "rev-parse", "HEAD"], { encoding: "utf8", stdio: "pipe" })
        if (r.status === 0) commit = r.stdout.trim() || null
    }
    return { version, commit }
}

/**
 * Deterministic serialisation: objects emit their keys SORTED, arrays keep
 * their order. Key order in a loaded JSON document is an artefact of how it
 * was written, not a contract — a fingerprint that moved when a field was
 * merely reordered would cry wolf until an operator learned to ignore it,
 * which is worse than having no check.
 */
function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]"
    if (value && typeof value === "object") {
        return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonical(value[k])).join(",") + "}"
    }
    return JSON.stringify(value ?? null)
}

/**
 * A fingerprint over the schema documents a build baked in.
 *
 * The schemas are sorted BY NAME first: which order `loadInstance` happens to
 * return them in is a directory-listing detail, and a fingerprint sensitive to
 * it would report drift on a machine whose filesystem sorts differently.
 */
export function schemaFingerprint(schemas = []) {
    const ordered = [...schemas].sort((a, b) => String(a?.name).localeCompare(String(b?.name)))
    return "sha256:" + createHash("sha256").update(canonical(ordered)).digest("hex")
}

/** The parsed build.json of a built Studio, or null when there is none. */
export function readBuildStamp(dir) {
    const path = join(dir, STAMP_FILE)
    if (!existsSync(path)) return null
    try {
        const parsed = JSON.parse(readFileSync(path, "utf8"))
        return parsed && typeof parsed === "object" ? parsed : null
    } catch {
        // An unreadable stamp is not a fresh build. Treat it as absent, which
        // carries the same remedy.
        return null
    }
}

/**
 * Compare a build's recorded origin against the live one.
 *
 * @returns {{stale: boolean, reasons: string[], unverified: string[]}}
 *
 * `reasons` names EVERY dimension that drifted, not the first — an operator
 * told about one, who rebuilds and immediately sees the warning again, learns
 * to distrust the check. `unverified` names dimensions this install cannot see
 * at all, so "not stale" is never mistaken for "verified fresh".
 */
export function stalenessOf(stamp, current) {
    const reasons = []
    const unverified = []

    if (!stamp) {
        return {
            stale: true,
            reasons: ["no build stamp — this instance has no built Studio, or it predates the stamp"],
            unverified: []
        }
    }

    const was = stamp.framework ?? {}
    const now = current.framework ?? {}

    if (was.version !== now.version) {
        reasons.push(`framework moved: built against ${was.version ?? "unknown"}, running ${now.version ?? "unknown"}`)
    } else if (was.commit && now.commit) {
        if (was.commit !== now.commit)
            reasons.push(`framework moved: built at ${String(was.commit).slice(0, 8)}, running ${String(now.commit).slice(0, 8)}`)
    } else {
        // Same version, and at least one side cannot name a commit. A drift
        // WITHIN this version is invisible from here; say so.
        unverified.push("framework commit — this install has no git checkout, so a change within the same version cannot be seen")
    }

    if (stamp.schemas !== current.schemas) reasons.push("schemas changed since the Studio was built — its baked forms no longer match the models")

    return { stale: reasons.length > 0, reasons, unverified }
}

/**
 * The live side of the comparison for an instance: what a build made right now
 * would record. One place, so `start` and `doctor` cannot drift apart.
 */
export function currentStamp(frameworkRoot, schemas) {
    return { framework: frameworkStamp(frameworkRoot), schemas: schemaFingerprint(schemas) }
}

/**
 * The whole check for an instance, in one call: read the built stamp under
 * `publicDir/studio` and compare it with what a build would record now.
 */
export function studioBuildStatus({ instanceRoot, frameworkRoot, schemas }) {
    const dir = join(instanceRoot, "public", "studio")
    const built = existsSync(join(dir, "index.html"))
    const verdict = stalenessOf(readBuildStamp(dir), currentStamp(frameworkRoot, schemas))
    return { built, ...verdict }
}

export default { frameworkStamp, schemaFingerprint, readBuildStamp, stalenessOf, currentStamp, studioBuildStatus, STAMP_FILE }
