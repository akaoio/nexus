/**
 * nexus update — self-update, the access lesson: the install is a plain
 * DEPLOYMENT of origin/main, so updating a git install is fetch + hard
 * reset (no merges, no stashes, nothing to conflict — local edits do not
 * belong in a deployment). Non-git installs get the exact command that
 * refreshes them instead of a half-guess.
 */

import { existsSync } from "fs"
import { join } from "path"
import { fileURLToPath } from "url"
import { spawnSync } from "child_process"
import { acquireUpdateLock, recordUpdate, readManifest } from "../install-state.js"

const NEXUS_ROOT = fileURLToPath(new URL("../../..", import.meta.url))

export async function update(args, flags, out) {
    const gitDir = join(NEXUS_ROOT, ".git")

    // The channels this command does not own answer FIRST, before any lock
    // exists — there is nothing to serialise, and a lock taken for work that
    // never happens is a lock that can leak (INST-09).
    // npm-managed installs belong to npm — say so precisely
    if (NEXUS_ROOT.includes("node_modules")) {
        out.print("This Nexus is npm-managed. Update it with:")
        out.print("  npm update -g nexus")
        out.emit({ ok: true, managed: "npm", root: NEXUS_ROOT })
        return
    }

    if (!existsSync(gitDir)) {
        out.print("This Nexus was installed from a tarball (no .git). Refresh it by re-running the installer:")
        out.print("  curl -fsSL https://raw.githubusercontent.com/akaoio/nexus/main/install.sh | sh")
        out.emit({ ok: true, managed: "tarball", root: NEXUS_ROOT })
        return
    }

    const git = (...argv) => spawnSync("git", ["-C", NEXUS_ROOT, ...argv], { encoding: "utf8", stdio: "pipe" })

    // NEVER DESTROY UNEXAMINED WORK. `update` is not cwd-scoped — it hard-resets
    // the installation this binary belongs to, wherever that is. A developer
    // running `nexus update` from a nexus checkout therefore loses whatever
    // they were working on, with no warning and no way back short of the
    // reflog. (Found the hard way: a test that assumed cwd-scoping reset a live
    // working tree.) install.sh already refuses a dirty tree; this is the other
    // half of the same contract, and there is no reason it should have been
    // applied to only one of the two paths that hard-reset.
    const dirty = git("status", "--porcelain").stdout.trim()
    if (dirty && flags.force !== true) {
        out.print(`${NEXUS_ROOT} has local changes that an update would discard:`)
        for (const line of dirty.split("\n")) out.print(`    ${line}`)
        out.print("")
        out.print("An install directory is a deployment, not a workspace — but nothing here")
        out.print("will be thrown away without you saying so. To update anyway:")
        out.print("    nexus update --force")
        out.error("refusing to hard-reset a dirty tree", { code: "E_UPDATE_DIRTY" })
        process.exitCode = 1
        return
    }

    // One update at a time (issue #8 answer 9). `openSync(path, "wx")` is an
    // ATOMIC exclusive create — the closest thing Node gives to access's
    // non-blocking flock, and unlike flock it exists on every platform Node
    // supports (N2 rules out a native module). access added its lock after a
    // real overlap regression; having it before anything can trigger an update
    // automatically is the cheap order.
    let lock
    try {
        lock = acquireUpdateLock(NEXUS_ROOT)
    } catch (error) {
        out.error(error.message, { code: "E_UPDATE_LOCKED" })
        process.exitCode = 1
        return
    }

    try {
        const before = git("rev-parse", "--short", "HEAD").stdout.trim()
        out.print(`Updating Nexus at ${NEXUS_ROOT} (currently ${before})…`)

        const fetch = git("fetch", "origin", "main")
        if (fetch.status !== 0) {
            out.error("git fetch failed: " + (fetch.stderr || fetch.stdout).trim(), { code: "E_UPDATE" })
            process.exitCode = 1
            return
        }
        const reset = git("reset", "--hard", "origin/main")
        if (reset.status !== 0) {
            out.error("git reset failed: " + (reset.stderr || reset.stdout).trim(), { code: "E_UPDATE" })
            process.exitCode = 1
            return
        }
        const after = git("rev-parse", "--short", "HEAD").stdout.trim()
        // Recorded so `nexus doctor` can answer "when was the framework last
        // updated, and through which channel?" — which nothing could before.
        // Tracking main stays the policy at 0.0.0; carrying the field now makes
        // --channel a later config change rather than a redesign.
        recordUpdate(NEXUS_ROOT, { channel: "git", ref: "origin/main", commit: after })
        out.print(after === before ? `Already up to date (${after}).` : `Updated ${before} → ${after}.`)

        // Restart what THIS install put there — the manifest knows, so nothing
        // is guessed (issue #8 answer 6). `try-restart`, never `restart`: a
        // unit the operator deliberately disabled must not be force-started by
        // an update. That is access's exact choice (update.sh:64) and the
        // reasoning carries over unchanged.
        //
        // Not a supervisor watching the tree: that would be a second
        // long-lived process to install, supervise and uninstall, and it would
        // fire on every file a hard reset touches.
        const units = readManifest(NEXUS_ROOT)?.units ?? []
        for (const unit of units) {
            const r = spawnSync("systemctl", ["--user", "try-restart", unit], { encoding: "utf8", stdio: "pipe" })
            if (r.status === 0) out.print(`  restarted ${unit}`)
            else out.print(`  ${unit}: not restarted (${(r.stderr || "systemctl unavailable").trim()})`)
        }

        // WHAT THIS JUST INVALIDATED. A built Studio (public/studio/) is a
        // COPY of this framework's src/studio/**, frozen when it was built —
        // so a framework that moved leaves every instance in the world serving
        // old Studio code against a new server. `update` cannot fix that: it
        // updates the installation the binary belongs to and holds no register
        // of the instances running against it, so there is no list to walk.
        // Saying so is the smallest honest thing it can do, and it is strictly
        // better than the silence it replaces. `nexus start` and `nexus doctor`
        // detect the same drift per instance, from the build stamp.
        if (after !== before) {
            out.print("")
            out.print("Instances with a BUILT Studio (public/studio/) now carry the old one —")
            out.print("this command cannot reach them. In each such instance:")
            out.print("    nexus studio build")
            out.print(`  ${out.dim("`nexus start` and `nexus doctor` report the drift too. `nexus dev` serves from source and needs nothing.")}`)
        }

        out.emit({ ok: true, managed: "git", before, after, root: NEXUS_ROOT, restarted: units, studioStale: after !== before })
    } finally {
        lock.release()
    }
}

export default { update }
