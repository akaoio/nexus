/**
 * Install-level state — what the installer changed, when it last updated, and
 * the lock that keeps two updates from overlapping (issue #8, answers 2/3/7/9).
 *
 * WHY THIS EXISTS AT ALL. `uninstall` did not know what the installer did; it
 * GUESSED two default paths. But `install.sh` writes its shim to
 * `${NEXUS_BIN:-$HOME/.local/bin}`, so an operator who set `NEXUS_BIN` got a
 * shim uninstall would never find — leaving a `nexus` on PATH pointing at a
 * deleted tree. The guess was right only in the case where guessing was
 * unnecessary. And it could not cover PATH entries at all, which is why
 * `uninstall` used to end by admitting they "can be dropped whenever".
 *
 * Everything lives INSIDE the install (`$NEXUS_HOME/.state/`), not in
 * `$XDG_STATE_HOME`. The install being ONE directory is what makes uninstall a
 * single removal; splitting state out would give two roots to reason about and
 * two things to find.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, openSync, closeSync } from "fs"
import { join } from "path"

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

export const MANIFEST_VERSION = 1
/** A lock older than this is presumed abandoned even if its pid was recycled. */
const LOCK_STALE_MS = 30 * 60 * 1000

export const stateDir = (home) => join(home, ".state")
const manifestPath = (home) => join(stateDir(home), "install.json")
const updatePath = (home) => join(stateDir(home), "last-update.json")
const lockPath = (home) => join(stateDir(home), "update.lock")

const ensureState = (home) => {
    mkdirSync(stateDir(home), { recursive: true })
    return stateDir(home)
}

/** Read a JSON state file. Absent → null. Corrupt → throws with `code`. */
function readJson(path, code, what) {
    if (!existsSync(path)) return null
    try {
        return JSON.parse(readFileSync(path, "utf8"))
    } catch (error) {
        // Deliberately NOT treated as absent. Falling back would make uninstall
        // remove LESS than the operator expects, silently — the failure this
        // whole module exists to stop.
        throw err(code, `${what} at ${path} is unreadable: ${error.message}`)
    }
}

/**
 * What the installer changed. `null` means an install that predates this — an
 * older install, not an error, and callers fall back to the documented
 * defaults (N3: an existing install must keep uninstalling cleanly).
 */
export const readManifest = (home) => readJson(manifestPath(home), "E_MANIFEST", "the install manifest")

/**
 * Record what the installer changed.
 *
 * `units` and `cronMarkers` are reserved for the service step and are written
 * empty now, so adding a supervised process later is DATA rather than a schema
 * change. `manifestVersion` for the same reason the other three formats carry
 * one (N4): the next version has to be able to read this one.
 */
export function writeManifest(home, { channel = "git", shims = [], pathEntries = [], units = [], cronMarkers = [] } = {}) {
    ensureState(home)
    const manifest = {
        manifestVersion: MANIFEST_VERSION,
        installedAt: new Date().toISOString(),
        channel,
        home,
        shims,
        pathEntries,
        units,
        cronMarkers
    }
    writeFileSync(manifestPath(home), JSON.stringify(manifest, null, 2))
    return manifest
}

/** When the framework itself was last updated, and through which channel. */
export const readUpdateRecord = (home) => readJson(updatePath(home), "E_UPDATE_RECORD", "the update record")

export function recordUpdate(home, { channel, ref = null, commit = null } = {}) {
    ensureState(home)
    const record = { channel, ref, commit, at: new Date().toISOString() }
    writeFileSync(updatePath(home), JSON.stringify(record, null, 2))
    return record
}

/** Is a process alive? `kill(pid, 0)` signals nothing and only tests existence. */
function alive(pid) {
    if (!Number.isInteger(pid) || pid <= 0) return false
    try {
        process.kill(pid, 0)
        return true
    } catch (error) {
        // EPERM means it exists and belongs to someone else — still alive.
        return error?.code === "EPERM"
    }
}

/**
 * Take the update lock, or refuse.
 *
 * `openSync(path, "wx")` is an ATOMIC exclusive create — the closest thing Node
 * gives to access's non-blocking `flock`, and unlike `flock` it exists on every
 * platform Node supports (N2 rules out a native module for this).
 *
 * A lock whose holder is gone, or which is older than LOCK_STALE_MS, is
 * reclaimed: a crashed update must not wedge the installation until someone
 * deletes a file by hand.
 *
 * @returns {{path: string, release: Function}}
 * @throws E_UPDATE_LOCKED naming the holder
 */
export function acquireUpdateLock(home) {
    ensureState(home)
    const path = lockPath(home)

    const take = () => {
        const fd = openSync(path, "wx")
        closeSync(fd)
        writeFileSync(path, JSON.stringify({ pid: process.pid, at: Date.now() }))
        return { path, release: () => rmSync(path, { force: true }) }
    }

    try {
        return take()
    } catch (error) {
        if (error?.code !== "EEXIST") throw error
    }

    let holder = null
    try {
        holder = JSON.parse(readFileSync(path, "utf8"))
    } catch {
        holder = null // an unreadable lock is as good as an abandoned one
    }

    const stale = !holder || !alive(holder.pid) || Date.now() - (holder.at ?? 0) > LOCK_STALE_MS
    if (!stale)
        throw err("E_UPDATE_LOCKED", `another update is running (pid ${holder.pid}, started ${new Date(holder.at).toISOString()})`)

    rmSync(path, { force: true })
    return take()
}

export default {
    MANIFEST_VERSION, stateDir, readManifest, writeManifest,
    readUpdateRecord, recordUpdate, acquireUpdateLock
}
