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

const NEXUS_ROOT = fileURLToPath(new URL("../../..", import.meta.url))

export async function update(args, flags, out) {
    const gitDir = join(NEXUS_ROOT, ".git")

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
        out.print("  (Windows)  irm https://raw.githubusercontent.com/akaoio/nexus/main/install.ps1 | iex")
        out.emit({ ok: true, managed: "tarball", root: NEXUS_ROOT })
        return
    }

    const git = (...argv) => spawnSync("git", ["-C", NEXUS_ROOT, ...argv], { encoding: "utf8", stdio: "pipe", shell: process.platform === "win32" })

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
    out.print(after === before ? `Already up to date (${after}).` : `Updated ${before} → ${after}.`)
    out.emit({ ok: true, managed: "git", before, after, root: NEXUS_ROOT })
}

export default { update }
