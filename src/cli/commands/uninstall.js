/**
 * nexus uninstall — remove the installation cleanly (the access lesson:
 * one command out, no residue). Instance directories are NEVER touched —
 * your apps and data are yours. Destructive, so it demands the typed
 * word or --yes.
 */

import { existsSync, rmSync } from "fs"
import { join } from "path"
import { homedir } from "os"
import { fileURLToPath } from "url"
import { readManifest } from "../install-state.js"

const NEXUS_ROOT = fileURLToPath(new URL("../../..", import.meta.url))

/**
 * What removing this install actually entails. Pure — it decides, it does not
 * remove, which is what makes it assertable (INST-02/03) after this file having
 * had no clauses of any kind.
 *
 * The MANIFEST is the authority when there is one. Guessing missed the shim
 * whenever `NEXUS_BIN` was set, leaving a `nexus` on PATH pointing at a deleted
 * tree — the guess was right only where guessing was unnecessary. With no
 * manifest (an older install) this falls back to the documented defaults and
 * SAYS which authority it used, because an existing install must keep
 * uninstalling cleanly (N3).
 */
export function plan(root = NEXUS_ROOT) {
    const manifest = readManifest(root)
    if (manifest)
        return {
            source: "manifest",
            root,
            shims: (manifest.shims ?? []).filter(existsSync),
            pathEntries: manifest.pathEntries ?? [],
            units: manifest.units ?? [],
            cronMarkers: manifest.cronMarkers ?? []
        }
    return {
        source: "defaults",
        root,
        shims: [join(homedir(), ".local", "bin", "nexus"), join(root, "shims", "nexus.cmd")].filter(existsSync),
        pathEntries: [],
        units: [],
        cronMarkers: []
    }
}

export async function uninstall(args, flags, out) {
    if (NEXUS_ROOT.includes("node_modules")) {
        out.print("This Nexus is npm-managed. Remove it with:")
        out.print("  npm uninstall -g nexus")
        out.emit({ ok: true, managed: "npm", root: NEXUS_ROOT })
        return
    }

    const removal = plan(NEXUS_ROOT)
    const shims = removal.shims

    out.print("This removes:")
    out.print(`  • ${NEXUS_ROOT}  (the Nexus source)`)
    for (const shim of shims) out.print(`  • ${shim}  (command shim)`)
    out.print("Your instance directories (apps, data) are NOT touched.")
    if (removal.source === "defaults") out.print("  (no install manifest — falling back to the default locations)")
    // PATH is not ours to rewrite silently, but it IS ours to NAME now that the
    // manifest records it. The old ending admitted these "can be dropped
    // whenever", which was an admission that uninstall was incomplete.
    for (const entry of removal.pathEntries) out.print(`  • PATH entry ${entry}  (remove it from your shell profile / user PATH)`)

    if (flags.yes !== true) {
        out.print("")
        out.print('Nothing was removed. Run again with --yes to confirm:')
        out.print("  nexus uninstall --yes")
        out.emit({ ok: true, removed: false })
        return
    }

    for (const shim of shims) rmSync(shim, { force: true })
    rmSync(NEXUS_ROOT, { recursive: true, force: true })
    out.print("Nexus removed.")
    if (removal.pathEntries.length) out.print(`  Still yours to remove: ${removal.pathEntries.join(", ")} from PATH.`)
    out.emit({ ok: true, removed: true, root: NEXUS_ROOT, source: removal.source, shims, pathEntries: removal.pathEntries })
}

export default { uninstall, plan }
