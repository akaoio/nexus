/**
 * Nexus is POSIX-only (POSIX-*) — ARCHITECTURE.md §1.1/§5, amended 2026-07-22.
 *
 * The project shipped `install.ps1` and counted "Windows native" as a
 * differentiator against Frappe. That promise was never verified: the script had
 * not run once on Windows. When it was finally executed — under PowerShell on
 * Linux — a real defect surfaced within minutes: `git fetch` and
 * `git reset --hard` both failed and the script still printed "Nexus
 * installed.", wrote a shim, and recorded a manifest claiming `channel: git`
 * with the LOCAL commit. A manifest asserting the one thing manifests exist to
 * prevent. And the fix could not be verified on the real platform.
 *
 * So the capability was withdrawn rather than left as an unverifiable claim —
 * the same judgement STATUS applies to MySQL, which is contract-pinned and
 * DECLARED unproven instead of being presented as equal.
 *
 * This clause exists so it does not drift back in. A Windows installer is not
 * wrong to want; re-adding one silently, with no way to run it, is.
 */

import { readFileSync, readdirSync, existsSync } from "fs"
import { fileURLToPath } from "url"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

Test.describe("Nexus is POSIX-only (POSIX)", () => {

    Test.it("POSIX-01 no PowerShell installer ships, and nothing points users at one", () => {
        assert.falsy(existsSync(join(ROOT, "install.ps1")), "install.ps1 was withdrawn — see ARCHITECTURE §5")

        const offenders = []
        const walk = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                if (entry.name === "node_modules" || entry.name === ".git" || entry.name === "vendor") continue
                const path = join(dir, entry.name)
                if (entry.isDirectory()) walk(path)
                else if (/\.(js|md|sh)$/.test(entry.name) && !path.includes("test/cli/posix-only")) {
                    // Design docs record history; they are allowed to mention it.
                    if (path.includes("docs/superpowers/")) continue
                    if (/install\.ps1|irm .*install/.test(readFileSync(path, "utf8"))) offenders.push(path.slice(ROOT.length))
                }
            }
        }
        walk(join(ROOT, "src"))
        walk(join(ROOT, "test"))
        // STATUS.md and ARCHITECTURE.md are the record of the decision — they
        // MUST be able to name what was withdrawn and why. The ban is on
        // shipping an installer or pointing a user at one, not on explaining
        // its absence; a rule that forbade the explanation would push the
        // reasoning out of the two documents that exist to hold it.
        for (const doc of ["README.md", "install.sh"]) {
            const path = join(ROOT, doc)
            if (existsSync(path) && /install\.ps1|irm .*install/.test(readFileSync(path, "utf8"))) offenders.push(doc)
        }
        assert.deepEqual(offenders, [], `these still point at a Windows installer that no longer exists: ${offenders.join(", ")}`)
    })

    Test.it("POSIX-02 the architecture contract records the withdrawal rather than quietly dropping it", () => {
        // N3: a DECLARED capability was removed, so it is written down with its
        // reason and its cost. A capability that vanishes without a note is how
        // a contract stops meaning anything.
        const arch = readFileSync(join(ROOT, "ARCHITECTURE.md"), "utf8")
        assert.truthy(/POSIX-only/.test(arch), "the scope change must be stated")
        assert.truthy(/N1–N6|N3/.test(arch.slice(arch.indexOf("POSIX-only"))), "and its impact on the invariants named")
    })

    Test.it("POSIX-03 the kernel keeps its path portability — that was never the Windows CLAIM", () => {
        // Deleting `WIN` from the FS layer would be ripping separator handling
        // out of a foundational akao-inherited module for no benefit. The thing
        // withdrawn was the installer and the promise, not path plumbing.
        const env = readFileSync(join(ROOT, "src/core/environment.js"), "utf8")
        assert.truthy(/WIN/.test(env), "kernel path portability stays")
    })
})
