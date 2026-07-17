/**
 * nexus config — read and write the instance's nexus.config.json from the CLI,
 * the general-purpose control plane (Frappe bench's get-config/set-config, but
 * one command). Dot-paths, JSON value coercion, secret redaction.
 *
 *   nexus config list                       # the whole config (secrets masked)
 *   nexus config get database.engine        # one value
 *   nexus config set database.engine turso  # coerced: "turso" string, 42 number, true bool
 *   nexus config set site.name "My App" --string
 *   nexus config unset semantic.model
 */

import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { getPath, setPath, unsetPath, coerce, redact, isSecretPath } from "../../app/config.js"

export async function config(args, flags, out) {
    const configPath = join(process.cwd(), "nexus.config.json")
    if (!existsSync(configPath)) {
        out.error("Not a Nexus instance (no nexus.config.json here)", { code: "E_NO_INSTANCE" })
        process.exitCode = 1
        return
    }
    const cfg = JSON.parse(readFileSync(configPath, "utf8"))
    const write = (next) => writeFileSync(configPath, JSON.stringify(next, null, 4) + "\n")
    const sub = args[0] ?? "list"
    const showSecrets = flags["show-secrets"] === true

    if (sub === "list" || (sub === "get" && args[1] === undefined)) {
        const shown = showSecrets ? cfg : redact(cfg)
        out.print(JSON.stringify(shown, null, 2))
        out.emit({ ok: true, config: shown })
        return
    }
    if (sub === "get") {
        const value = getPath(cfg, args[1])
        const masked = !showSecrets && isSecretPath(args[1]) ? "***" : value
        out.print(masked === undefined ? "" : typeof masked === "object" ? JSON.stringify(masked, null, 2) : String(masked))
        out.emit({ ok: true, key: args[1], value: masked })
        return
    }
    if (sub === "set") {
        if (args[1] === undefined || args[2] === undefined) {
            out.error("nexus config set <key> <value>", { code: "E_USAGE" })
            process.exitCode = 2
            return
        }
        const value = coerce(args[2], flags.string === true)
        write(setPath(cfg, args[1], value))
        out.print(`${out.green("✓")} ${args[1]} = ${out.cyan(JSON.stringify(value))}`)
        out.emit({ ok: true, key: args[1], value })
        return
    }
    if (sub === "unset") {
        if (args[1] === undefined) {
            out.error("nexus config unset <key>", { code: "E_USAGE" })
            process.exitCode = 2
            return
        }
        write(unsetPath(cfg, args[1]))
        out.print(`${out.green("✓")} unset ${args[1]}`)
        out.emit({ ok: true, key: args[1] })
        return
    }
    out.error(`Unknown: nexus config ${sub} (use list|get|set|unset)`, { code: "E_USAGE" })
    process.exitCode = 2
}

export default config
