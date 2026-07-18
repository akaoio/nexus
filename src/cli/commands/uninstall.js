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

const NEXUS_ROOT = fileURLToPath(new URL("../../..", import.meta.url))

export async function uninstall(args, flags, out) {
    if (NEXUS_ROOT.includes("node_modules")) {
        out.print("This Nexus is npm-managed. Remove it with:")
        out.print("  npm uninstall -g nexus")
        out.emit({ ok: true, managed: "npm", root: NEXUS_ROOT })
        return
    }

    // the shims the installers may have written (user-scoped, both OSes)
    const shims = [
        join(homedir(), ".local", "bin", "nexus"),
        join(NEXUS_ROOT, "shims", "nexus.cmd")
    ].filter(existsSync)

    out.print("This removes:")
    out.print(`  • ${NEXUS_ROOT}  (the Nexus source)`)
    for (const shim of shims) out.print(`  • ${shim}  (command shim)`)
    out.print("Your instance directories (apps, data) are NOT touched.")

    if (flags.yes !== true) {
        out.print("")
        out.print('Nothing was removed. Run again with --yes to confirm:')
        out.print("  nexus uninstall --yes")
        out.emit({ ok: true, removed: false })
        return
    }

    for (const shim of shims) rmSync(shim, { force: true })
    rmSync(NEXUS_ROOT, { recursive: true, force: true })
    out.print("Nexus removed. (PATH entries added by the installer can be dropped whenever.)")
    out.emit({ ok: true, removed: true, root: NEXUS_ROOT })
}

export default { uninstall }
