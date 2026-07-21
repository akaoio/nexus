/**
 * nexus service install | status | uninstall — supervise `nexus start` so it
 * survives a reboot (issue #8 answers 5 and 6).
 *
 * EXPLICIT, never automatic. `install.sh` does not do this behind your back: a
 * dev tool that registers a background process without being asked is how
 * `curl | sh` earns its reputation. You run this, on the instance you mean.
 *
 * The DECISION lives in ../service-plan.js and is pure; this performs it. That
 * split is what lets the clauses assert the behaviour without enabling a real
 * unit on whoever runs the suite.
 */

import { existsSync, mkdirSync, writeFileSync, rmSync, readFileSync } from "fs"
import { dirname, join } from "path"
import { homedir } from "os"
import { spawnSync } from "child_process"
import { fileURLToPath } from "url"
import { servicePlan, renderUnit } from "../service-plan.js"
import { readManifest, writeManifest } from "../install-state.js"

const NEXUS_ROOT = fileURLToPath(new URL("../../..", import.meta.url))
const has = (cmd) => spawnSync(process.platform === "win32" ? "where" : "which", [cmd], { stdio: "ignore" }).status === 0

/** Everything the plan depends on, read from the real world once. */
const environment = (instanceRoot) => ({
    instanceRoot,
    platform: process.platform,
    home: homedir(),
    configHome: process.env.XDG_CONFIG_HOME,
    nexusRoot: NEXUS_ROOT,
    node: process.execPath,
    // `systemctl --user` existing is not enough — the user MANAGER has to be
    // reachable, which it is not in a bare container or over a plain `su`.
    hasSystemd: has("systemctl") && spawnSync("systemctl", ["--user", "show-environment"], { stdio: "ignore" }).status === 0,
    hasCron: has("crontab")
})

/** Merge what the service installed into the install manifest, so uninstall can undo it. */
function record(plan) {
    const current = readManifest(NEXUS_ROOT) ?? {}
    writeManifest(NEXUS_ROOT, {
        ...current,
        channel: current.channel ?? "git",
        commit: current.commit ?? null,
        shims: current.shims ?? [],
        pathEntries: current.pathEntries ?? [],
        units: [...new Set([...(current.units ?? []), ...plan.units])],
        cronMarkers: [...new Set([...(current.cronMarkers ?? []), ...plan.cronMarkers])]
    })
}

/** crontab, edited by marker so unrelated entries survive (access's init.sh pattern). */
function rewriteCrontab(mutate) {
    const existing = spawnSync("crontab", ["-l"], { encoding: "utf8" })
    const lines = (existing.status === 0 ? existing.stdout : "").split("\n").filter((l) => l.length)
    const next = mutate(lines).join("\n") + "\n"
    return spawnSync("crontab", ["-"], { input: next, encoding: "utf8" }).status === 0
}

export async function service(args, flags, out) {
    const action = args[1] ?? "status"
    const root = process.cwd()
    const plan = servicePlan(environment(root))

    if (action === "status") {
        const manifest = readManifest(NEXUS_ROOT)
        const units = manifest?.units ?? []
        out.print(plan.supported ? `Supervision available via ${plan.manager}.` : `Supervision unavailable: ${plan.reason}`)
        if (!units.length && !(manifest?.cronMarkers ?? []).length) out.print("  Nothing installed by nexus.")
        for (const unit of units) {
            const active = spawnSync("systemctl", ["--user", "is-active", unit], { encoding: "utf8" }).stdout.trim()
            const enabled = spawnSync("systemctl", ["--user", "is-enabled", unit], { encoding: "utf8" }).stdout.trim()
            out.print(`  ${unit} — ${active || "unknown"} · ${enabled || "unknown"}`)
        }
        for (const marker of manifest?.cronMarkers ?? []) out.print(`  cron ${marker} — installed`)
        const linger = spawnSync("loginctl", ["show-user", process.env.USER ?? "", "--property=Linger"], { encoding: "utf8" }).stdout.trim()
        if (linger) out.print(`  ${linger} ${linger.endsWith("no") ? "(service starts at login, not at boot — `loginctl enable-linger` fixes that)" : ""}`)
        out.emit({ ok: true, action, manager: plan.manager ?? null, units, cronMarkers: manifest?.cronMarkers ?? [] })
        return
    }

    if (action === "install") {
        if (!plan.supported) {
            out.error(plan.reason, { code: plan.code })
            process.exitCode = 1
            return
        }
        if (plan.manager === "systemd") {
            mkdirSync(dirname(plan.unitPath), { recursive: true })
            writeFileSync(plan.unitPath, renderUnit(plan))
            out.print(`Wrote ${plan.unitPath}`)
        } else {
            const ok = rewriteCrontab((lines) => [...lines.filter((l) => !l.includes(plan.marker)), plan.cronLine])
            if (!ok) {
                out.error("could not write the crontab", { code: "E_SERVICE_CRON" })
                process.exitCode = 1
                return
            }
            out.print(`Installed the @reboot line (${plan.marker}).`)
        }

        for (const command of plan.commands) {
            if (plan.manager === "cron" && command.argv[0] === "crontab") continue // already done above
            const r = spawnSync(command.argv[0], command.argv.slice(1), { encoding: "utf8", stdio: "pipe" })
            if (r.status === 0) {
                out.print(`  ${command.argv.join(" ")} — ${command.explain}`)
                continue
            }
            const message = (r.stderr || r.stdout || "failed").trim()
            // Graceful degradation over abort — the access lesson. A
            // non-fatal step that fails warns and the install continues.
            if (command.fatal) {
                out.error(`${command.argv.join(" ")} failed: ${message}`, { code: "E_SERVICE_INSTALL" })
                process.exitCode = 1
                return
            }
            out.print(`  WARNING: ${command.argv.join(" ")} failed (${message})`)
            out.print(`           ${command.explain} — without it the service starts at your next login, not at boot.`)
        }

        record(plan)
        out.print("")
        out.print(`Nexus will now be supervised for ${plan.instanceRoot}.`)
        out.print("  nexus service status     see what is running")
        out.print("  nexus service uninstall  remove it")
        out.emit({ ok: true, action, manager: plan.manager, units: plan.units, cronMarkers: plan.cronMarkers })
        return
    }

    if (action === "uninstall") {
        const manifest = readManifest(NEXUS_ROOT)
        const units = manifest?.units ?? []
        const markers = manifest?.cronMarkers ?? []
        if (!units.length && !markers.length) {
            out.print("Nothing installed by nexus to remove.")
            out.emit({ ok: true, action, removed: [] })
            return
        }
        for (const unit of units) {
            spawnSync("systemctl", ["--user", "disable", "--now", unit], { stdio: "ignore" })
            const path = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "systemd", "user", unit)
            if (existsSync(path)) rmSync(path, { force: true })
            out.print(`  removed ${unit}`)
        }
        if (units.length) spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" })
        for (const marker of markers) {
            rewriteCrontab((lines) => lines.filter((l) => !l.includes(marker)))
            out.print(`  removed cron ${marker}`)
        }
        writeManifest(NEXUS_ROOT, { ...manifest, units: [], cronMarkers: [] })
        out.emit({ ok: true, action, removed: [...units, ...markers] })
        return
    }

    out.error(`unknown action "${action}" — use install, status or uninstall`, { code: "E_SERVICE_ACTION" })
    process.exitCode = 1
}

export default { service }
