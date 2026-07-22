/**
 * The service story (SVC-*) — issue #8 answers 5, 6 and 10, ratified.
 *
 * This is the ONLY step in issue #8 that puts a long-lived process on a
 * machine, which is why `servicePlan()` is pure and `serviceApply()` performs
 * it: a clause that installed a real unit would enable a real background
 * process on whoever ran the suite. Everything below asserts the DECISION.
 *
 * Access's triple redundancy (system unit + 5-minute timer + cron) does not
 * transfer. It installs as root to FHS paths; nexus lives in $HOME with no
 * sudo, so `systemd --user` is the only mechanism available. And access needs
 * its timer because its job is a periodic DDNS sync — the timer IS the work.
 * Nexus's job is a long-lived server, where a timer is not a second layer of
 * safety but a second thing that can start a duplicate process (SVC-03).
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"
import { spawnSync } from "child_process"
import Test, { assert } from "../../src/core/Test.js"
import { servicePlan, renderUnit, unitName } from "../../src/cli/service-plan.js"

/** A directory that looks like a nexus instance. */
function instance(name = "shop") {
    const box = mkdtempSync(join(tmpdir(), "nexus-svc-"))
    const root = join(box, name)
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, "nexus.config.json"), JSON.stringify({ configVersion: 1, site: { name } }))
    return { box, root }
}

const LINUX = { platform: "linux", home: "/home/x", nexusRoot: "/home/x/.nexus", node: "/usr/bin/node", hasSystemd: true, hasCron: true }

Test.describe("Service plan (SVC)", () => {

    Test.it("SVC-01 the unit runs nexus start IN the instance, restarts always, and is wanted by default.target", () => {
        const { box, root } = instance("shop")
        try {
            const plan = servicePlan({ ...LINUX, instanceRoot: root })
            assert.equal(plan.supported, true)
            assert.equal(plan.manager, "systemd")
            assert.equal(plan.unitName, "nexus-shop.service")
            assert.truthy(plan.unitPath.endsWith("/.config/systemd/user/nexus-shop.service"), plan.unitPath)

            const unit = renderUnit(plan)
            assert.truthy(unit.includes(`WorkingDirectory=${root}`), `it runs IN the instance: ${unit}`)
            assert.truthy(unit.includes("/usr/bin/node /home/x/.nexus/bin/nexus.js start"), `it runs nexus start: ${unit}`)
            assert.truthy(unit.includes("Restart=always"), "a server that exits must come back")
            // default.target, not multi-user.target: this is a USER unit, and
            // the whole no-sudo story depends on it staying one.
            assert.truthy(unit.includes("WantedBy=default.target"), unit)
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("SVC-02 macOS and Windows refuse, and plan NO writes — launchd untested on hardware nobody has is the mistake #8 exists to prevent", () => {
        const { box, root } = instance()
        try {
            for (const platform of ["darwin", "win32"]) {
                const plan = servicePlan({ ...LINUX, platform, instanceRoot: root })
                assert.equal(plan.supported, false, platform)
                assert.equal(plan.code, "E_SERVICE_PLATFORM")
                assert.deepEqual(plan.writes, [], "and writes nothing at all")
                assert.deepEqual(plan.commands, [])
            }

            // The two refusals differ, and should. macOS IS a supported dev
            // platform without a supervisor story, so it points at what to do
            // instead. Windows is not a supported platform at all since the
            // POSIX-only change, so there is nothing to point at — saying
            // "run nexus start yourself" there would imply a support it does
            // not have.
            const darwin = servicePlan({ ...LINUX, platform: "darwin", instanceRoot: root })
            assert.truthy(/nexus start/.test(darwin.reason), `macOS is told what to do instead: ${darwin.reason}`)
            const win = servicePlan({ ...LINUX, platform: "win32", instanceRoot: root })
            assert.truthy(/POSIX-only|not a supported platform/.test(win.reason), `Windows is told it is unsupported: ${win.reason}`)
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("SVC-03 with no systemd it degrades to a marker-based @reboot cron line — and NEVER plans both", () => {
        const { box, root } = instance("shop")
        try {
            const plan = servicePlan({ ...LINUX, hasSystemd: false, instanceRoot: root })
            assert.equal(plan.supported, true, "graceful degradation over abort — the access lesson")
            assert.equal(plan.manager, "cron")
            assert.truthy(plan.cronLine.startsWith("@reboot "), plan.cronLine)
            assert.truthy(plan.cronLine.includes(plan.marker), "marker-based, so uninstall removes exactly it and nothing else")
            assert.deepEqual(plan.units, [], "a cron fallback installs NO unit — running both would be the duplicate-process problem")

            const systemd = servicePlan({ ...LINUX, instanceRoot: root })
            assert.equal(systemd.cronLine, null, "and where systemd exists, no cron line either")

            const neither = servicePlan({ ...LINUX, hasSystemd: false, hasCron: false, instanceRoot: root })
            assert.equal(neither.supported, false)
            assert.equal(neither.code, "E_SERVICE_MANAGER")
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("SVC-04 the plan names exactly what the manifest must record, so uninstall can undo it by name", () => {
        const { box, root } = instance("shop")
        try {
            const systemd = servicePlan({ ...LINUX, instanceRoot: root })
            assert.deepEqual(systemd.units, ["nexus-shop.service"])
            assert.deepEqual(systemd.cronMarkers, [])

            const cron = servicePlan({ ...LINUX, hasSystemd: false, instanceRoot: root })
            assert.deepEqual(cron.units, [])
            assert.equal(cron.cronMarkers.length, 1, "the marker is what uninstall greps out")
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("SVC-07 lingering is requested and explained — a refusal downgrades to a warning that still installs the service", () => {
        // Verified on this machine: Linger=no by default, and
        // org.freedesktop.login1's set-self-linger carries allow_any=yes — so
        // enable-linger succeeds WITHOUT root, which is the fact that makes a
        // no-sudo service story possible at all. Had it needed root, the honest
        // answer to #8 answer 5 would have been "there is none".
        const { box, root } = instance()
        try {
            const plan = servicePlan({ ...LINUX, instanceRoot: root })
            const linger = plan.commands.find((c) => c.argv.join(" ").includes("enable-linger"))
            assert.truthy(linger, "it asks for lingering, or the unit dies at logout")
            assert.equal(linger.fatal, false, "and a refusal must not abort the install — access prints WARNING and continues")
            assert.truthy(/linger/i.test(linger.explain), `it says WHY: ${linger.explain}`)

            const enable = plan.commands.find((c) => c.argv.join(" ").includes("enable"))
            assert.truthy(enable)
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("SVC-08 outside an instance it refuses rather than installing a unit pointing nowhere", () => {
        const box = mkdtempSync(join(tmpdir(), "nexus-svc-none-"))
        try {
            const plan = servicePlan({ ...LINUX, instanceRoot: box })
            assert.equal(plan.supported, false)
            assert.equal(plan.code, "E_NO_INSTANCE")
            assert.deepEqual(plan.writes, [])
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("SVC-06 update restarts with try-restart, never restart — a unit the operator disabled stays disabled", () => {
        // access's exact choice (update.sh:64), and the reasoning carries over
        // unchanged: an update must refresh what is running, not start what
        // someone deliberately stopped.
        const src = readFileSync(fileURLToPath(new URL("../../src/cli/commands/update.js", import.meta.url)), "utf8")
        assert.truthy(/try-restart/.test(src), "it uses try-restart")
        assert.falsy(/"restart"/.test(src), "and never a bare restart")
        assert.truthy(/units/.test(src), "restarting what the MANIFEST recorded, not a guess")
    })

    Test.it("SVC-09 systemd itself accepts the generated unit — validated by its own parser, without installing anything", () => {
        // "It looks like a unit file" is not the same claim as "systemd will
        // load it". `systemd-analyze verify` parses it exactly as the manager
        // would — a real check that enables no process, which matters because
        // installing one is a system-modifying action a test has no business
        // performing.
        //
        // But the verifier is environment-sensitive: on a runner without a
        // usable systemd it rejects even trivially valid units. So a KNOWN-GOOD
        // unit is probed first. If that fails, this environment cannot tell us
        // anything and the clause skips honestly; only if the probe passes does
        // OUR unit have to pass too. That distinction — "our unit is wrong" vs
        // "this machine cannot check" — is the whole point, and collapsing it
        // would make the clause either a false alarm or a rubber stamp.
        const { box, root } = instance("shop")
        const probeFile = join(box, "nexus-probe.service")
        const unitFile = join(box, "nexus-shop.service")
        try {
            writeFileSync(probeFile, "[Unit]\nDescription=probe\n\n[Service]\nType=oneshot\nExecStart=/bin/true\n\n[Install]\nWantedBy=default.target\n")
            const probe = spawnSync("systemd-analyze", ["verify", "--user", probeFile], { encoding: "utf8" })
            if (probe.error || probe.status !== 0) {
                console.warn(`  SVC-09 skipped — systemd-analyze cannot validate here: ${(probe.stderr || probe.error?.message || "").trim().split("\n")[0]}`)
                return
            }

            // Real paths, so the only thing under test is the unit we generate.
            const plan = servicePlan({
                ...LINUX,
                instanceRoot: root,
                node: process.execPath,
                nexusRoot: fileURLToPath(new URL("../..", import.meta.url))
            })
            writeFileSync(unitFile, renderUnit(plan))
            const r = spawnSync("systemd-analyze", ["verify", "--user", unitFile], { encoding: "utf8" })
            assert.truthy(r.status === 0, `systemd rejected the unit: ${(r.stderr || r.stdout || "").trim()}`)
        } finally {
            rmSync(box, { recursive: true, force: true })
        }
    })

    Test.it("SVC-05 uninstall's plan carries the recorded units and cron markers", async () => {
        const { plan } = await import("../../src/cli/commands/uninstall.js")
        const { writeManifest } = await import("../../src/cli/install-state.js")
        const home = mkdtempSync(join(tmpdir(), "nexus-svc-un-"))
        try {
            writeManifest(home, { channel: "git", shims: [], pathEntries: [], units: ["nexus-shop.service"], cronMarkers: ["nexus:shop"] })
            const removal = plan(home)
            assert.deepEqual(removal.units, ["nexus-shop.service"], "part 1 reserved these fields; this is what fills them")
            assert.deepEqual(removal.cronMarkers, ["nexus:shop"])
        } finally {
            rmSync(home, { recursive: true, force: true })
        }
    })
})
