/**
 * nexus CLI — entry, argument parsing and dispatch (ARCHITECTURE.md §5.2).
 *
 * A thin shell over the public APIs (rule 1): commands import Data Plane
 * modules (Model, …) — never kernel internals. Zero dependencies (rule 2):
 * the argument parser and styling are self-contained.
 *
 * Exit codes (public contract): 0 success · 1 operational failure · 2 usage.
 */

import { readFileSync } from "fs"
import { createOutput } from "./output.js"
import { create } from "./commands/create.js"
import { test } from "./commands/test.js"
import { dev } from "./commands/dev.js"
import { start } from "./commands/start.js"
import { migrate } from "./commands/migrate.js"
import { site } from "./commands/site.js"
import { app } from "./commands/app.js"
import { user } from "./commands/user.js"
import { doctor } from "./commands/doctor.js"

const VALUE_FLAGS = new Set(["port", "site", "engine", "name", "role", "roles"])

export function parseArgs(argv) {
    const flags = {}
    const positional = []
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]
        if (arg.startsWith("--")) {
            const eq = arg.indexOf("=")
            if (eq !== -1) flags[arg.slice(2, eq)] = arg.slice(eq + 1)
            else {
                const name = arg.slice(2)
                if (VALUE_FLAGS.has(name) && argv[i + 1] !== undefined && !argv[i + 1].startsWith("--")) flags[name] = argv[++i]
                else flags[name] = true
            }
        } else if (arg === "-v") flags.version = true
        else if (arg === "-h") flags.help = true
        else positional.push(arg)
    }
    return { command: positional[0], args: positional.slice(1), flags }
}

async function resolveAppCommand(name) {
    try {
        const { existsSync } = await import("fs")
        if (!existsSync("nexus.config.json")) return null
        const { loadInstance } = await import("./instance.js")
        const { loadExtensions } = await import("../app/Extensions.js")
        const { apps } = loadInstance(process.cwd())
        const extensions = await loadExtensions(process.cwd(), apps)
        return extensions.commands.get(name) ?? null
    } catch {
        return null // a broken instance never masks the unknown-command error
    }
}

function version(out) {
    const pkg = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))
    out.print(`nexus v${pkg.version}`)
    out.emit({ ok: true, name: pkg.name, version: pkg.version })
}

function help(out) {
    out.print(`${out.bold("nexus")} — a pure-web meta-framework

${out.bold("Usage")}
  nexus <command> [arguments] [--flags]

${out.bold("Commands")}
  create <dir>       Scaffold a new Nexus instance     ${out.dim("--site <name> --engine <e> · interactive in a TTY")}
  dev                Serve the current instance        ${out.dim("--port <n>")}
  start              Production server, self-served TLS ${out.dim("--port <n> [--insecure]")}
  test [filter]      Validate the instance's schemas
  migrate            Preview schema changes            ${out.dim("--apply to execute")}
  site backup        Dump schemas + data + ledger      ${out.dim("[file]")}
  site restore       Additive restore — never deletes  ${out.dim("<file> --apply")}
  app new|list       App lifecycle
  user list|add      Manage identities (ZEN pubkey + roles)  ${out.dim("--roles a,b")}
  doctor             Diagnose the instance
  version            Print the nexus version
  help               Show this message

${out.bold("Global flags")}
  --json             Machine-readable output (versioned contract)
  -v, --version      Print version
  -h, --help         Show help`)
    out.emit({
        ok: true,
        commands: ["create", "dev", "start", "test", "migrate", "site", "app", "user", "doctor", "version", "help"]
    })
}

export async function main(argv) {
    const { command, args, flags } = parseArgs(argv)
    const out = createOutput(flags)

    try {
        if (flags.version || command === "version") return version(out)
        if (flags.help || !command || command === "help") return help(out)

        switch (command) {
            case "create":
                return await create(args, flags, out)
            case "dev":
                return await dev(args, flags, out)
            case "start":
                return await start(args, flags, out)
            case "test":
                return await test(args, flags, out)
            case "migrate":
                return await migrate(args, flags, out)
            case "site":
                return await site(args, flags, out)
            case "app":
                return await app(args, flags, out)
            case "user":
                return await user(args, flags, out)
            case "doctor":
                return await doctor(args, flags, out)
            default: {
                // App commands (§8.3 "commands"): inside an instance, unknown
                // commands fall through to the apps' registered subcommands
                const appCommand = await resolveAppCommand(command)
                if (appCommand) return await appCommand.run({ args, flags, out, root: process.cwd() })
                out.error(`Unknown command: ${command}`, { code: "E_USAGE" })
                out.hint("Run `nexus help` for available commands")
                process.exitCode = 2
            }
        }
    } catch (error) {
        out.error(error?.message || String(error))
        process.exitCode = process.exitCode || 1
    }
}
