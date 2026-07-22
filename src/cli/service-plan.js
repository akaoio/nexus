/**
 * The service plan — what supervising `nexus start` would entail, decided
 * without doing any of it (issue #8 answers 5 and 10).
 *
 * PURE ON PURPOSE. This is the only part of the install lifecycle that puts a
 * long-lived process on a machine, so a clause that installed a real unit would
 * enable a real background process on whoever ran the suite. Deciding and
 * performing are split the same way `migrate.js` (plan/hotApply) and
 * `lifecycle.js` (entityDeletePlan/applyEntityDelete) already split them.
 *
 * WHY NOT ACCESS'S TRIPLE REDUNDANCY (system unit + 5-minute timer + cron):
 * access installs as ROOT to FHS paths and its units are SYSTEM units. Nexus
 * lives in $HOME with no sudo, so `systemd --user` is the only mechanism
 * available. And access needs its timer because its job is a periodic DDNS
 * sync — the timer IS the work. Nexus's job is a long-lived server, where a
 * second supervisor is not another layer of safety but another thing that can
 * start a DUPLICATE process. Redundancy is a virtue only when the layers do
 * different work.
 *
 * WHAT DOES TRANSFER is the doctrine: graceful degradation over abort (a
 * missing systemd warns and falls back, it does not fail), and marker-based
 * idempotent edits to files we do not own (the crontab), so uninstall removes
 * exactly ours.
 *
 * THE FACT THIS RESTS ON: `systemd --user` units die at logout unless lingering
 * is enabled, and `loginctl enable-linger` needs no root
 * (org.freedesktop.login1's set-self-linger carries allow_any=yes). That was
 * checked rather than assumed — had it needed root, the honest answer to
 * issue #8 answer 5 would have been "there is no service story without sudo".
 */

import { existsSync } from "fs"
import { join } from "path"

/** Unit name for an instance directory: nexus-<instance>.service */
export const unitName = (instanceRoot) => `nexus-${instanceRoot.split(/[/\\]/).filter(Boolean).pop()}.service`

const refuse = (code, reason) => ({ supported: false, code, reason, writes: [], commands: [], units: [], cronMarkers: [], cronLine: null })

/**
 * Decide how (or whether) to supervise `nexus start` for an instance.
 *
 * @param {Object} env - everything the decision depends on, injected so it is testable
 * @param {string} env.instanceRoot
 * @param {string} env.platform - process.platform
 * @param {string} env.home
 * @param {string} env.nexusRoot - the Nexus install
 * @param {string} env.node - the node binary
 * @param {boolean} env.hasSystemd
 * @param {boolean} env.hasCron
 * @param {string} [env.configHome] - XDG_CONFIG_HOME
 * @returns {Object} plan
 */
export function servicePlan({ instanceRoot, platform, home, nexusRoot, node, hasSystemd, hasCron, configHome } = {}) {
    // launchd (Darwin) and Windows services are genuinely different mechanisms,
    // and shipping one untested on hardware nobody here has is the exact
    // mistake issue #8 exists to prevent. Nexus already has the honest
    // precedent: MySQL is contract-pinned and DECLARED unproven rather than
    // claimed. Same treatment — refuse, and say what to do instead.
    if (platform === "darwin")
        return refuse("E_SERVICE_PLATFORM", "macOS service supervision is not supported yet (launchd is untested here) — run `nexus start` under your own supervisor, or a launchd plist you control.")
    // Nexus is POSIX-only; there is no Windows installer to reach this. The
    // guard stays as a GUARD, not a support claim — someone running from a
    // clone on Windows gets a sentence rather than a systemd unit written into
    // a directory that means nothing there.
    if (platform === "win32")
        return refuse("E_SERVICE_PLATFORM", "Nexus is POSIX-only — Windows is not a supported platform.")

    // A unit pointing at a directory that is not an instance would start,
    // fail, and restart forever. Refuse instead.
    if (!instanceRoot || !existsSync(join(instanceRoot, "nexus.config.json")))
        return refuse("E_NO_INSTANCE", `no nexus.config.json in ${instanceRoot} — run this from an instance directory.`)

    const exec = `${node} ${join(nexusRoot, "bin", "nexus.js")} start`

    if (hasSystemd) {
        const name = unitName(instanceRoot)
        const unitPath = join(configHome || join(home, ".config"), "systemd", "user", name)
        return {
            supported: true,
            manager: "systemd",
            unitName: name,
            unitPath,
            exec,
            instanceRoot,
            writes: [unitPath],
            commands: [
                { argv: ["systemctl", "--user", "daemon-reload"], fatal: true, explain: "pick up the new unit" },
                { argv: ["systemctl", "--user", "enable", "--now", name], fatal: true, explain: "start it, and start it at login" },
                {
                    // NOT fatal. A user unit is killed at logout unless
                    // lingering is on, so this is what makes "survives a
                    // reboot" true — but failing the whole install because one
                    // property could not be set is the opposite of the access
                    // lesson (WARNING: and continue). The service still works;
                    // it starts at login instead of at boot, and the operator
                    // is told exactly that.
                    argv: ["loginctl", "enable-linger"],
                    fatal: false,
                    explain: "enable lingering, so the service starts at boot rather than at your next login"
                }
            ],
            units: [name],
            cronMarkers: [],
            cronLine: null
        }
    }

    if (hasCron) {
        // The FALLBACK, not a second layer — installed only where systemd is
        // absent. Marker-based so it is idempotent and so uninstall can strip
        // exactly ours out of a crontab we do not own (access's init.sh
        // pattern, reused rather than reinvented).
        const marker = `nexus:${instanceRoot.split(/[/\\]/).filter(Boolean).pop()}`
        return {
            supported: true,
            manager: "cron",
            unitName: null,
            unitPath: null,
            exec,
            instanceRoot,
            marker,
            writes: [],
            commands: [{ argv: ["crontab", "-"], fatal: true, explain: "install the @reboot line" }],
            units: [],
            cronMarkers: [marker],
            cronLine: `@reboot cd ${instanceRoot} && ${exec} # ${marker}`
        }
    }

    return refuse("E_SERVICE_MANAGER", "neither systemd --user nor cron is available — run `nexus start` under a supervisor of your choice.")
}

/** The unit file text. One render path, so install and update cannot drift. */
export function renderUnit(plan) {
    return `[Unit]
Description=Nexus — ${plan.instanceRoot.split(/[/\\]/).filter(Boolean).pop()}
Documentation=https://github.com/akaoio/nexus
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=${plan.instanceRoot}
ExecStart=${plan.exec}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`
}

export default { servicePlan, renderUnit, unitName }
