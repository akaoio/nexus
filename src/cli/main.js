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

const VALUE_FLAGS = new Set(["port", "site"])

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
  create <dir>     Scaffold a new Nexus instance     ${out.dim("--site <name>")}
  dev              Serve the current instance        ${out.dim("--port <n>")}
  test [filter]    Validate the instance's schemas
  version          Print the nexus version
  help             Show this message

${out.bold("Global flags")}
  --json           Machine-readable output (versioned contract)
  -v, --version    Print version
  -h, --help       Show help`)
    out.emit({
        ok: true,
        commands: ["create", "dev", "test", "version", "help"]
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
            case "test":
                return await test(args, flags, out)
            default:
                out.error(`Unknown command: ${command}`, { code: "E_USAGE" })
                out.hint("Run `nexus help` for available commands")
                process.exitCode = 2
        }
    } catch (error) {
        out.error(error?.message || String(error))
        process.exitCode = process.exitCode || 1
    }
}
