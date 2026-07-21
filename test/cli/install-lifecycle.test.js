/**
 * Install lifecycle — state, manifest, lock (INST-*) — issue #8 answers 1, 2,
 * 3, 4, 7, 9, ratified 2026-07-21.
 *
 * `update.js` and `uninstall.js` have had NO clauses of any kind. That is the
 * last entry on issue #9's coverage map, and it was left open deliberately:
 * pinning behaviour issue #8 had not yet decided would have frozen it by
 * accident. With the contract settled, it closes here.
 *
 * The defect that makes the manifest non-optional is concrete. `uninstall.js`
 * did not know what the installer did — it GUESSED two default paths. But
 * `install.sh` writes its shim to `${NEXUS_BIN:-$HOME/.local/bin}`, so an
 * operator who set NEXUS_BIN got a shim uninstall would never find, leaving a
 * `nexus` on PATH pointing at a deleted tree. INST-02 is that case.
 */

import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import Test, { assert } from "../../src/core/Test.js"
import {
    stateDir, readManifest, writeManifest, recordUpdate, readUpdateRecord, acquireUpdateLock
} from "../../src/cli/install-state.js"

const INSTALL_SH = fileURLToPath(new URL("../../install.sh", import.meta.url))
const scratch = () => mkdtempSync(join(tmpdir(), "nexus-inst-"))

Test.describe("Install lifecycle — state and manifest (INST)", () => {

    Test.it("INST-01 the manifest round-trips; an absent one reads as null, a corrupt one refuses", () => {
        const home = scratch()
        try {
            assert.equal(readManifest(home), null, "no manifest is an OLDER INSTALL, not an error")

            const manifest = {
                channel: "git",
                home,
                shims: [join(home, "bin", "nexus")],
                pathEntries: [join(home, "bin")]
            }
            writeManifest(home, manifest)
            const read = readManifest(home)
            assert.equal(read.manifestVersion, 1, "versioned, because the next version has to read it (N4)")
            assert.equal(read.channel, "git")
            assert.deepEqual(read.shims, manifest.shims)
            assert.truthy(read.installedAt)
            // Reserved for the service step, present and empty now, so adding a
            // unit later is data rather than a schema change.
            assert.deepEqual(read.units, [])
            assert.deepEqual(read.cronMarkers, [])

            // The commit survives a REWRITE. `nexus service install` rewrites
            // the manifest to add its unit; a writer that only knew the fields
            // it cared about would silently forget which tree this install is.
            writeManifest(home, { ...read, commit: "abc123", units: ["nexus-x.service"] })
            const after = readManifest(home)
            assert.equal(after.commit, "abc123")
            assert.deepEqual(after.units, ["nexus-x.service"])

            writeFileSync(join(stateDir(home), "install.json"), "{ not json")
            assert.throws(() => readManifest(home), "E_MANIFEST")
        } finally {
            rmSync(home, { recursive: true, force: true })
        }
    })

    Test.it("INST-04 the update lock is exclusive — a second holder is refused, and told who has it", () => {
        const home = scratch()
        try {
            const first = acquireUpdateLock(home)
            assert.truthy(first, "the first caller gets the lock")

            const second = assert.throws(() => acquireUpdateLock(home), "E_UPDATE_LOCKED")
            assert.truthy(second.message.includes(String(process.pid)), `names the holder: ${second.message}`)

            first.release()
            const third = acquireUpdateLock(home)
            assert.truthy(third, "releasing frees it")
            third.release()
        } finally {
            rmSync(home, { recursive: true, force: true })
        }
    })

    Test.it("INST-05 a lock whose holder is gone is reclaimed, not left blocking forever", () => {
        const home = scratch()
        try {
            // A pid that cannot be running: a crashed update must not wedge the
            // installation until someone deletes a file by hand.
            mkdirSync(stateDir(home), { recursive: true })
            writeFileSync(join(stateDir(home), "update.lock"), JSON.stringify({ pid: 2147483646, at: Date.now() }))

            const lock = acquireUpdateLock(home)
            assert.truthy(lock, "a stale lock is reclaimable")
            lock.release()
        } finally {
            rmSync(home, { recursive: true, force: true })
        }
    })

    Test.it("INST-06 an update records the channel, ref and commit — so doctor can answer when and through what", () => {
        const home = scratch()
        try {
            assert.equal(readUpdateRecord(home), null)
            recordUpdate(home, { channel: "git", ref: "origin/main", commit: "abc1234" })
            const record = readUpdateRecord(home)
            assert.equal(record.channel, "git")
            assert.equal(record.ref, "origin/main")
            assert.equal(record.commit, "abc1234")
            assert.truthy(record.at, "and when")
        } finally {
            rmSync(home, { recursive: true, force: true })
        }
    })

    Test.it("INST-07 doctor reports the INSTALL when run outside an instance — channel, home, manifest, last update", () => {
        const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))
        const box = scratch() // deliberately not an instance
        try {
            const r = spawnSync(process.execPath, [BIN, "doctor"], { cwd: box, encoding: "utf8", timeout: 60000 })
            const said = r.stdout + r.stderr
            assert.truthy(/install —/.test(said), `it names the channel and home: ${said}`)
            assert.truthy(/install manifest/.test(said), "and whether a manifest exists")
            assert.truthy(/last update/.test(said), "and when it last updated — which nothing could answer before")
            assert.truthy(/reporting the INSTALL instead/.test(said), "and it says WHY it changed scope, rather than silently reporting something else")
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("INST-09 update REFUSES to hard-reset a dirty tree — the guard install.sh had and this path did not", () => {
        // Found the hard way, and worth stating plainly: `nexus update` is NOT
        // cwd-scoped. It hard-resets the installation the binary belongs to,
        // wherever that is — so a developer running it from a nexus checkout
        // loses their work with no warning and no way back short of the reflog.
        // (A test that assumed cwd-scoping reset a live working tree while this
        // very chunk was being written.) install.sh already refused a dirty
        // tree; there was no reason the other hard-resetting path should not.
        //
        // Driven WITHOUT invoking the real command, deliberately: a clause that
        // ran `nexus update` would reset whatever checkout the suite lives in,
        // which is exactly the accident it exists to describe.
        const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))
        const src = readFileSync(fileURLToPath(new URL("../../src/cli/commands/update.js", import.meta.url)), "utf8")

        assert.truthy(/status", "--porcelain"/.test(src), "it asks whether the tree is dirty")
        assert.truthy(/E_UPDATE_DIRTY/.test(src), "and refuses with a typed error")
        assert.truthy(src.indexOf("--porcelain") < src.indexOf('reset", "--hard'), "and it asks BEFORE it resets")
        assert.truthy(/flags\.force/.test(src), "with an explicit override rather than none")
        assert.truthy(existsSync(BIN))
    })

    Test.it("INST-08 install.sh refuses a DIRTY checkout before touching anything, and NEXUS_FORCE overrides", () => {
        const home = scratch()
        try {
            // A git install with a local edit. No remote is configured on
            // purpose: if the refusal did not come first, the run would fail at
            // `git fetch` instead — so this also pins the ORDERING.
            spawnSync("git", ["init", "-q", home])
            spawnSync("git", ["-C", home, "config", "user.email", "t@t"])
            spawnSync("git", ["-C", home, "config", "user.name", "t"])
            writeFileSync(join(home, "keep.txt"), "committed\n")
            spawnSync("git", ["-C", home, "add", "-A"])
            spawnSync("git", ["-C", home, "commit", "-qm", "base"])
            writeFileSync(join(home, "keep.txt"), "MY LOCAL EDIT\n")

            const env = { ...process.env, NEXUS_HOME: home, NEXUS_BIN: join(home, "bin") }
            const refused = spawnSync("sh", [INSTALL_SH], { env, encoding: "utf8", timeout: 60000 })

            assert.notEqual(refused.status, 0, "a dirty tree must abort")
            const said = refused.stdout + refused.stderr
            assert.truthy(said.includes("keep.txt"), `it names what would be lost: ${said}`)
            assert.truthy(/NEXUS_FORCE/.test(said), "and how to proceed anyway")
            assert.equal(readFileSync(join(home, "keep.txt"), "utf8"), "MY LOCAL EDIT\n", "aborting leaves the work intact")
            assert.falsy(said.includes("fetch"), "the refusal comes BEFORE any network call")
        } finally {
            rmSync(home, { recursive: true, force: true })
        }
    })
})

Test.describe("Install lifecycle — uninstall reads the manifest (INST-U)", () => {

    /** A fake install: a tree, a shim at a NON-default location, a manifest. */
    function fakeInstall({ withManifest }) {
        const box = scratch()
        const home = join(box, "nexus-home")
        const bin = join(box, "custom-bin") // NOT ~/.local/bin — the case the guess misses
        mkdirSync(join(home, "bin"), { recursive: true })
        mkdirSync(bin, { recursive: true })
        writeFileSync(join(home, "bin", "nexus.js"), "// source")
        const shim = join(bin, "nexus")
        writeFileSync(shim, "#!/bin/sh\n")
        const keep = join(bin, "something-else")
        writeFileSync(keep, "not ours\n")
        if (withManifest) writeManifest(home, { channel: "git", home, shims: [shim], pathEntries: [bin] })
        return { box, home, shim, keep }
    }

    Test.it("INST-02 uninstall removes exactly what the manifest names — including a shim the old guess could never find", async () => {
        const { box, home, shim, keep } = fakeInstall({ withManifest: true })
        try {
            const { plan } = await import("../../src/cli/commands/uninstall.js")
            const removal = plan(home)

            assert.truthy(removal.shims.includes(shim), `a NEXUS_BIN shim must be found: ${JSON.stringify(removal.shims)}`)
            assert.falsy(removal.shims.includes(keep), "and nothing else in that directory")
            assert.equal(removal.source, "manifest", "the manifest is the authority when there is one")
            assert.deepEqual(removal.pathEntries, [dirname(shim)], "PATH entries are named so they can be undone")
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("INST-03 with NO manifest, uninstall still removes the documented defaults — an older install keeps working", async () => {
        const { box, home } = fakeInstall({ withManifest: false })
        try {
            const { plan } = await import("../../src/cli/commands/uninstall.js")
            const removal = plan(home)
            assert.equal(removal.source, "defaults", "it says which authority it used")
            assert.truthy(Array.isArray(removal.shims), "and still produces a plan rather than refusing")
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })
})
