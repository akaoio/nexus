/**
 * The production Studio's build lifecycle — STAMP-*, CREATE-STUDIO-*,
 * CREATE-GITIGNORE, UPDATE-STUDIO-*.
 *
 * A built Studio is a copy of the framework's own src/studio/** frozen at
 * build time, with the instance's schemas BAKED into its shell. Both move
 * underneath it: `nexus update` replaces the framework, and editing a model in
 * dev replaces the schemas. Nothing used to record either, so nothing could
 * tell whether a built Studio was still true — it would render forms for
 * fields that no longer exist and serve old code against a new server, in
 * silence.
 *
 * The comparison that answers "is this build still true?" is a function over
 * data, so it is driven here across every case — no stamp, a moved commit,
 * changed schemas, an install that cannot see commits at all — without booting
 * anything. Only the REPORT needs a server, and only one clause pays for one.
 */

import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import Test, { assert } from "../../src/core/Test.js"
import { frameworkStamp, schemaFingerprint, readBuildStamp, stalenessOf } from "../../src/cli/studio-stamp.js"

const NEXUS_ROOT = fileURLToPath(new URL("../../", import.meta.url))
const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

const SCHEMA = { name: "task", fields: { title: { type: "text" }, done: { type: "boolean" } } }

Test.describe("Studio build lifecycle (STAMP)", () => {
    Test.it("STAMP-01 a build records what it was built from: framework version, commit, and a schema fingerprint", async () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-stamp-"))
        try {
            const { buildStudio } = await import("../../src/cli/commands/studio.js")
            const out = join(scratch, "studio")
            await buildStudio({ root: NEXUS_ROOT, out, mount: "/studio/", config: {}, schemas: [SCHEMA], meta: {} })

            const stamp = readBuildStamp(out)
            assert.truthy(stamp, "a build with no record of its origin cannot be checked for staleness")
            assert.equal(stamp.framework.version, frameworkStamp(NEXUS_ROOT).version)
            assert.equal(stamp.framework.commit, frameworkStamp(NEXUS_ROOT).commit)
            assert.equal(stamp.schemas, schemaFingerprint([SCHEMA]))
            assert.truthy(!Number.isNaN(Date.parse(stamp.builtAt)), "builtAt must be a real timestamp")
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("STAMP-02 the schema fingerprint is deterministic under key REORDERING, and changes when a field does", () => {
        // Key order in a loaded JSON document is not a contract. A fingerprint
        // that changed when a field was merely reordered would cry wolf until
        // the operator learned to ignore it, which costs more than no check.
        const a = { name: "task", fields: { title: { type: "text" }, done: { type: "boolean" } } }
        const reordered = { fields: { done: { type: "boolean" }, title: { type: "text" } }, name: "task" }
        assert.equal(schemaFingerprint([a]), schemaFingerprint([reordered]))

        // Order of the schemas themselves is likewise not a contract.
        const b = { name: "note", fields: { body: { type: "text" } } }
        assert.equal(schemaFingerprint([a, b]), schemaFingerprint([b, a]))

        // But a real change must be visible — that is the whole job.
        const changed = { name: "task", fields: { title: { type: "text" }, done: { type: "text" } } }
        assert.notEqual(schemaFingerprint([a]), schemaFingerprint([changed]))
        const added = { name: "task", fields: { title: { type: "text" }, done: { type: "boolean" }, due: { type: "date" } } }
        assert.notEqual(schemaFingerprint([a]), schemaFingerprint([added]))
    })

    Test.it("STAMP-03 stalenessOf answers each case with its OWN reason — fresh, unbuilt, moved framework, changed schemas, both", () => {
        const current = { framework: { version: "1.0.0", commit: "aaaaaaa" }, schemas: "sha256:abc" }

        const fresh = stalenessOf({ framework: { version: "1.0.0", commit: "aaaaaaa" }, schemas: "sha256:abc" }, current)
        assert.equal(fresh.stale, false)
        assert.equal(fresh.reasons.length, 0)

        // No stamp at all: either there is no build, or the build predates this
        // mechanism. The remedy is identical, so one answer serves both.
        const none = stalenessOf(null, current)
        assert.equal(none.stale, true)
        assert.truthy(none.reasons.join(" ").includes("no build"), none.reasons.join(" "))

        const moved = stalenessOf({ framework: { version: "1.0.0", commit: "bbbbbbb" }, schemas: "sha256:abc" }, current)
        assert.equal(moved.stale, true)
        assert.equal(moved.reasons.length, 1)
        assert.truthy(/framework/i.test(moved.reasons[0]), moved.reasons[0])

        const edited = stalenessOf({ framework: { version: "1.0.0", commit: "aaaaaaa" }, schemas: "sha256:zzz" }, current)
        assert.equal(edited.stale, true)
        assert.equal(edited.reasons.length, 1)
        assert.truthy(/schema/i.test(edited.reasons[0]), edited.reasons[0])

        // Both drifted: BOTH are named. Reporting only the first would send an
        // operator to rebuild, see the warning again, and distrust the check.
        const both = stalenessOf({ framework: { version: "0.9.0", commit: "bbbbbbb" }, schemas: "sha256:zzz" }, current)
        assert.equal(both.stale, true)
        assert.equal(both.reasons.length, 2)
    })

    Test.it("STAMP-04 an install with no commit to read reports what it could NOT check, rather than claiming freshness", () => {
        // A tarball or npm install has no git checkout, so `commit` is null on
        // both sides and a within-version drift is INVISIBLE here. Saying "up
        // to date" would be a claim this install cannot support.
        const current = { framework: { version: "1.0.0", commit: null }, schemas: "sha256:abc" }
        const same = stalenessOf({ framework: { version: "1.0.0", commit: null }, schemas: "sha256:abc" }, current)
        assert.equal(same.stale, false)
        assert.truthy(same.unverified.length > 0, "an unverifiable dimension must be reported, not silently passed")
        assert.truthy(/commit/i.test(same.unverified.join(" ")), same.unverified.join(" "))

        // A version change is still visible without a commit, and is still stale.
        assert.equal(stalenessOf({ framework: { version: "0.9.0", commit: null }, schemas: "sha256:abc" }, current).stale, true)

        // And where the commit IS readable on both sides, nothing is unverified.
        const git = { framework: { version: "1.0.0", commit: "aaaaaaa" }, schemas: "sha256:abc" }
        assert.equal(stalenessOf(git, git).unverified.length, 0)
    })

    Test.it("STAMP-05 `nexus start` reports a stale build and still serves the data plane", async () => {
        // Never refuse: the data plane does not depend on the built Studio, and
        // refusing to serve an API because an admin UI is stale would be a
        // worse failure than the staleness itself.
        const scratch = mkdtempSync(join(tmpdir(), "nexus-stampstart-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const instance = join(scratch, "shop")
        const cfgPath = join(instance, "nexus.config.json")
        const cfg = JSON.parse(readFileSync(cfgPath, "utf8"))
        cfg.token_secret = "fixed-stamp-secret"
        cfg.api_keys = [{ key: "k-admin", user: "alice", roles: ["admin"] }]
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 4))

        // Build one, the way an operator would, then move its stamp so the
        // build is genuinely stale rather than merely asserted to be.
        const built = spawnSync(process.execPath, [BIN, "studio", "build", "--json"], { cwd: instance, encoding: "utf8" })
        assert.equal(built.status, 0, built.stdout + built.stderr)
        const stampPath = join(instance, "public", "studio", "build.json")
        const stamp = JSON.parse(readFileSync(stampPath, "utf8"))
        stamp.schemas = "sha256:deliberately-not-what-is-loaded"
        writeFileSync(stampPath, JSON.stringify(stamp, null, 4))

        const proc = spawn(process.execPath, [BIN, "start", "--json", "--port", "0", "--insecure"], { cwd: instance })
        try {
            const boot = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("start did not come up")), 8000)
                let buf = ""
                proc.stdout.on("data", (c) => { buf += c; try { const p = JSON.parse(buf); clearTimeout(timer); p.ok ? resolve(p) : reject(new Error(p.error || "start failed")) } catch {} })
                proc.on("exit", () => reject(new Error("start exited early")))
            })
            assert.truthy(boot.studio, "the boot payload must carry the Studio verdict")
            assert.equal(boot.studio.stale, true)
            assert.truthy(boot.studio.reasons.join(" ").match(/schema/i), boot.studio.reasons.join(" "))

            // The server is UP and answering — that is the half that must not
            // have been traded away for the warning.
            const res = await fetch(boot.url + "/api/v1/task", { headers: { "x-api-key": "k-admin" } })
            assert.truthy(res.status < 500, `the data plane must still serve: ${res.status}`)
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("STAMP-06 `nexus start` on an instance with NO build NAMES the command instead of leaving bare 404s", async () => {
        // An instance is entitled to have no admin UI in production — that is
        // the default, deliberately (the built shell serves at the site root,
        // pre-login, with every schema document baked in). What it is not
        // entitled to is presenting that as an unexplained 404 on every Studio
        // route.
        const scratch = mkdtempSync(join(tmpdir(), "nexus-nobuild-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const instance = join(scratch, "shop")
        const cfgPath = join(instance, "nexus.config.json")
        const cfg = JSON.parse(readFileSync(cfgPath, "utf8"))
        cfg.token_secret = "fixed-nobuild-secret"
        cfg.api_keys = [{ key: "k-admin", user: "alice", roles: ["admin"] }]
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 4))
        assert.equal(existsSync(join(instance, "public", "studio")), false, "create must NOT build one")

        const proc = spawn(process.execPath, [BIN, "start", "--port", "0", "--insecure"], { cwd: instance })
        try {
            const said = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("start did not come up")), 8000)
                let buf = ""
                proc.stdout.on("data", (c) => { buf += c; if (/studio/i.test(buf)) { clearTimeout(timer); resolve(buf) } })
                proc.on("exit", () => reject(new Error("start exited early: " + buf)))
            })
            assert.truthy(said.includes("nexus studio build"), `start must name the command: ${said}`)
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("CREATE-STUDIO-01 `create` does NOT build a production Studio, and SAYS the command that would", () => {
        // Building here was implemented first and then withdrawn. `/` is a
        // Studio route and `nexus start` checks the built Studio BEFORE the
        // static handler, so a build present means the site root serves the
        // Studio shell — pre-authentication, with full schema documents baked
        // into its boot payload. Building at create would have turned that
        // from a surface an operator chose into one every instance has by
        // default, as a side effect of a task described as wiring.
        const scratch = mkdtempSync(join(tmpdir(), "nexus-createstudio-"))
        try {
            const r = spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch, encoding: "utf8" })
            assert.equal(r.status, 0, r.stdout + r.stderr)
            assert.equal(
                existsSync(join(scratch, "shop", "public", "studio")),
                false,
                "a production admin UI must be a decision, not a default"
            )
            assert.truthy(r.stdout.includes("nexus studio build"), `create must name the command: ${r.stdout}`)
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("CREATE-STUDIO-02 a build an operator DOES run is stamped for that instance, and reads back FRESH", async () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-buildfresh-"))
        try {
            spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
            const instance = join(scratch, "shop")
            const r = spawnSync(process.execPath, [BIN, "studio", "build", "--json"], { cwd: instance, encoding: "utf8" })
            assert.equal(r.status, 0, r.stdout + r.stderr)

            const stamp = readBuildStamp(join(instance, "public", "studio"))
            assert.truthy(stamp, "the build must record its origin")

            // Fresh against the instance it was built for — the round trip,
            // not merely a file that exists.
            const { loadInstance } = await import("../../src/cli/instance.js")
            const live = { framework: frameworkStamp(NEXUS_ROOT), schemas: schemaFingerprint(loadInstance(instance).schemas) }
            const verdict = stalenessOf(stamp, live)
            assert.equal(verdict.stale, false, verdict.reasons.join(" · "))

            // And a schema edit makes it stale, with no update and no restart:
            // the common case, and the one nothing could see before.
            const drifted = stalenessOf(stamp, { ...live, schemas: schemaFingerprint([{ name: "task", fields: { title: { type: "text" } } }]) })
            assert.equal(drifted.stale, true)
            assert.truthy(/schema/i.test(drifted.reasons.join(" ")), drifted.reasons.join(" "))
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("CREATE-GITIGNORE the generated .gitignore covers what create GENERATES", () => {
        // create now writes 400-odd built files into a directory the user is
        // about to `git init`. Generated files belong in .gitignore, and this
        // is a consequence of building at create time rather than a stray tidy.
        const scratch = mkdtempSync(join(tmpdir(), "nexus-gitignore-"))
        try {
            spawnSync(process.execPath, [BIN, "create", "shop", "--json"], { cwd: scratch, encoding: "utf8" })
            const path = join(scratch, "shop", ".gitignore")
            assert.truthy(existsSync(path), "a .gitignore must be generated")
            const lines = readFileSync(path, "utf8").split("\n").map((l) => l.trim())
            // `.nexus/` is where the sqlite database actually lives — the first
            // draft of this list said `.data/`, which covers nothing, and only
            // reading a real instance directory caught it.
            for (const entry of ["public/studio/", ".nexus/", "node_modules/", ".certs/"])
                assert.truthy(lines.includes(entry), `.gitignore must cover ${entry}: ${lines.join(" · ")}`)
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("UPDATE-STUDIO-01 a successful update TELLS the operator it just invalidated every built Studio", () => {
        // STRUCTURAL, on purpose. `update` hard-resets the installation the
        // binary belongs to — running it here is precisely the accident INST-09
        // exists to describe, and it once destroyed a live worktree. So this
        // asserts the notice sits on the SUCCESS path of the real source rather
        // than invoking the command to watch it print.
        const source = readFileSync(join(NEXUS_ROOT, "src/cli/commands/update.js"), "utf8")
        const notice = source.indexOf("nexus studio build")
        assert.truthy(notice > 0, "update must name the command an operator has to run")
        // …and on the path taken after the reset succeeds, not in the npm /
        // tarball early-returns, which never invalidated anything.
        const managed = source.indexOf('managed: "tarball"')
        assert.truthy(notice > managed, "the notice belongs after the paths that update nothing")
    })
})
