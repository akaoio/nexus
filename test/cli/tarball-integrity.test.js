/**
 * The tarball install path (INST-10..13) — issue #8 answer 8, step 4.
 *
 * The ratified answer was: keep TLS + GitHub identity as the trust root and do
 * not invent a signing scheme (N2 — key custody, rotation and a verification
 * path in the installer is a security system to maintain forever, and a
 * neglected one is worse than none because it LOOKS like protection). The
 * concrete improvement available without any of that was to make a tarball
 * install *identifiable*: resolve the branch to a commit, fetch THAT commit,
 * and record it.
 *
 * Reading the path to implement it turned up something the answer did not
 * mention. `curl … | tar -xz` under `set -e` cannot see a failing curl: in
 * POSIX sh a pipeline's status is the LAST command's, so
 *
 *     sh -c 'set -e; false | true; echo $?'   →   0
 *
 * A download that dies partway therefore reaches `tar`, and whether that
 * becomes a refusal or a silently truncated installation is up to whichever
 * tar is present. INST-10 removes the ambiguity by not piping at all.
 *
 * These drive the real `install.sh` with a fake `curl` and no `git` on PATH,
 * so the shell logic itself is under test rather than a re-description of it.
 */

import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync, readFileSync, chmodSync, symlinkSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"
import Test, { assert } from "../../src/core/Test.js"

const INSTALL_SH = fileURLToPath(new URL("../../install.sh", import.meta.url))
const FAKE_SHA = "0123456789abcdef0123456789abcdef01234567"

/**
 * A PATH holding everything install.sh needs EXCEPT git — so it takes the
 * tarball branch — plus a `curl` the test controls.
 */
function sandbox({ curlBehaviour }) {
    const box = mkdtempSync(join(tmpdir(), "nexus-tar-"))
    const bin = join(box, "bin")
    mkdirSync(bin, { recursive: true })

    // Real tools, deliberately excluding git.
    for (const tool of ["sh", "tar", "gzip", "gunzip", "mkdir", "rm", "chmod", "sed", "date", "cat", "mktemp", "node", "printf", "uname", "env"]) {
        const found = spawnSync("sh", ["-c", `command -v ${tool} || true`], { encoding: "utf8" }).stdout.trim()
        if (found && !existsSync(join(bin, tool))) {
            try { symlinkSync(found, join(bin, tool)) } catch {}
        }
    }

    // A payload tarball that extracts to a plausible tree.
    const payload = join(box, "payload")
    mkdirSync(join(payload, "nexus-main", "bin"), { recursive: true })
    writeFileSync(join(payload, "nexus-main", "bin", "nexus.js"), "// from the tarball\n")
    writeFileSync(join(payload, "nexus-main", "package.json"), JSON.stringify({ name: "nexus" }))
    const tgz = join(box, "payload.tgz")
    spawnSync("tar", ["-czf", tgz, "-C", payload, "nexus-main"])

    const curl = join(bin, "curl")
    writeFileSync(curl, curlBehaviour({ tgz, sha: FAKE_SHA, box }))
    chmodSync(curl, 0o755)

    return { box, bin, tgz }
}

/** Run install.sh in the sandbox, with only its PATH. */
function runInstall({ bin, home, binDir, extraEnv = {} }) {
    return spawnSync("sh", [INSTALL_SH], {
        encoding: "utf8",
        timeout: 60000,
        env: { PATH: bin, HOME: home, NEXUS_HOME: home, NEXUS_BIN: binDir, ...extraEnv }
    })
}

Test.describe("Tarball install integrity (INST)", () => {

    Test.it("INST-10 a download that fails ABORTS before extraction — a truncated stream never becomes an installation", () => {
        // The hole this closes is mechanical, not hypothetical:
        //     sh -c 'set -e; false | true; echo $?'  →  0
        // so `curl … | tar -xz` hides a failing curl behind a tar that exits 0.
        const { box, bin } = sandbox({
            curlBehaviour: ({ sha, tgz }) => `#!/bin/sh
# Resolving the commit works. The DOWNLOAD emits a COMPLETE, VALID tarball and
# THEN fails — which is the case that discriminates: a curl that dies before
# writing anything makes tar fail too, so \`set -e\` catches it by accident. A
# curl that writes and then fails leaves tar exiting 0, the pipeline reporting
# 0, and the install proceeding on a download that did not succeed.
case "$*" in
    *commits*) printf '%s' "${sha}"; exit 0 ;;
    *)
        out=""
        want=""
        for a in "$@"; do
            if [ "$want" = "1" ]; then out="$a"; want=""; fi
            [ "$a" = "-o" ] && want=1
        done
        if [ -n "$out" ]; then cat "${tgz}" > "$out"; else cat "${tgz}"; fi
        exit 22 ;;
esac
`
        })
        const home = join(box, "home")
        try {
            const r = runInstall({ bin, home, binDir: join(box, "bin-shim") })
            assert.notEqual(r.status, 0, `a failed download must abort: ${r.stdout}${r.stderr}`)
            assert.falsy(existsSync(join(home, "bin", "nexus.js")), "and nothing may be left behind that looks installed")
            assert.falsy(existsSync(join(box, "bin-shim", "nexus")), "least of all a shim pointing at a tree that was never extracted")
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("INST-11 the tarball is fetched for a RESOLVED COMMIT, not a moving branch ref", () => {
        // Resolving `main` and then downloading `main` are two requests, and a
        // push between them yields a tree that is not the commit you resolved.
        // Downloading the commit closes that window and is what makes the
        // recorded SHA true rather than approximate.
        const { box, bin } = sandbox({
            curlBehaviour: ({ tgz, sha, box: outer }) => `#!/bin/sh
printf '%s\\n' "$*" >> "${outer}/curl.log"
case "$*" in
    *commits*) printf '%s' "${sha}"; exit 0 ;;
    *)
        # -o <file> is the last argument in install.sh's invocation
        out=""
        for a in "$@"; do prev="$out"; out="$a"; done
        cat "${tgz}" > "$out"
        exit 0 ;;
esac
`
        })
        const home = join(box, "home")
        try {
            const r = runInstall({ bin, home, binDir: join(box, "bin-shim") })
            assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
            const log = readFileSync(join(box, "curl.log"), "utf8")
            assert.truthy(log.includes(FAKE_SHA), `the download must name the commit: ${log}`)
            assert.falsy(/archive\/refs\/heads\/main/.test(log), `and not the moving branch ref: ${log}`)
            assert.truthy(existsSync(join(home, "bin", "nexus.js")), "and it actually installed")
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("INST-12 the manifest records the commit, so a tarball install is identifiable", () => {
        const { box, bin } = sandbox({
            curlBehaviour: ({ tgz, sha }) => `#!/bin/sh
case "$*" in
    *commits*) printf '%s' "${sha}"; exit 0 ;;
    *) out=""; for a in "$@"; do out="$a"; done; cat "${tgz}" > "$out"; exit 0 ;;
esac
`
        })
        const home = join(box, "home")
        try {
            const r = runInstall({ bin, home, binDir: join(box, "bin-shim") })
            assert.equal(r.status, 0, `${r.stdout}${r.stderr}`)
            const manifest = JSON.parse(readFileSync(join(home, ".state", "install.json"), "utf8"))
            assert.equal(manifest.channel, "tarball")
            assert.equal(manifest.commit, FAKE_SHA, "a tarball install could not say which tree it was, before this")
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("INST-13 when the commit cannot be resolved it still installs, records the truth, and says so", () => {
        // Degrade, do not abort — the access lesson. An unresolvable SHA (rate
        // limit, offline mirror) is a reason to install an UNIDENTIFIED tree
        // and say so, not a reason to refuse to install at all. Recording
        // `commit: null` rather than omitting the field is the honest shape:
        // absent would read as "not applicable".
        const { box, bin } = sandbox({
            curlBehaviour: ({ tgz }) => `#!/bin/sh
case "$*" in
    *commits*) exit 22 ;;
    *) out=""; for a in "$@"; do out="$a"; done; cat "${tgz}" > "$out"; exit 0 ;;
esac
`
        })
        const home = join(box, "home")
        try {
            const r = runInstall({ bin, home, binDir: join(box, "bin-shim") })
            assert.equal(r.status, 0, `an unresolvable commit must not block the install: ${r.stdout}${r.stderr}`)
            assert.truthy(existsSync(join(home, "bin", "nexus.js")))
            const manifest = JSON.parse(readFileSync(join(home, ".state", "install.json"), "utf8"))
            assert.equal(manifest.commit, null, "and the manifest must not claim a commit it does not know")
            assert.truthy(/could not resolve|unidentified|unknown commit/i.test(r.stdout), `and the operator is told: ${r.stdout}`)
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })
})
