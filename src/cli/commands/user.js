/**
 * nexus user — manage the site's identities (roster of ZEN public keys + roles).
 * A shell over src/core/App/users.js and nexus.config.json's `identities`. Adding any
 * identity turns on required auth (no "open to all" once users exist).
 *
 *   nexus user list
 *   nexus user add <pub> --name Alice --roles admin,editor
 *   nexus user role <pub> --roles editor
 *   nexus user remove <pub>
 */

import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { listUsers, addUser, removeUser, setRoles, labelOf } from "../../core/App/users.js"

const parseRoles = (flags) =>
    typeof flags.roles === "string"
        ? flags.roles.split(",").map((s) => s.trim()).filter(Boolean)
        : typeof flags.role === "string"
            ? [flags.role]
            : []

export async function user(args, flags, out) {
    const configPath = join(process.cwd(), "nexus.config.json")
    if (!existsSync(configPath)) {
        out.error("Not a Nexus instance (no nexus.config.json here)", { code: "E_NO_INSTANCE" })
        process.exitCode = 1
        return
    }
    const config = JSON.parse(readFileSync(configPath, "utf8"))
    const identities = listUsers(config)
    const write = (next) => writeFileSync(configPath, JSON.stringify({ ...config, identities: next }, null, 4) + "\n")
    const sub = args[0] ?? "list"
    const roles = parseRoles(flags)

    try {
        if (sub === "list") {
            if (!identities.length) out.print(out.dim("No users yet. `nexus user add <pub> --roles admin` to create the first — until then dev runs the open DEV identity and production refuses to start."))
            for (const i of identities) out.print(`  ${out.bold(labelOf(i))}  ${out.dim(i.pub)}  ${out.cyan((i.roles ?? []).join(", ") || "—")}`)
            out.emit({ ok: true, users: identities })
            return
        }
        if (sub === "add") {
            const next = addUser(identities, { pub: args[1], name: flags.name, roles })
            write(next)
            out.print(`${out.green("✓")} added ${out.bold(flags.name || String(args[1]).slice(0, 12) + "…")}  ${out.dim(roles.join(", ") || "no roles")}`)
            out.emit({ ok: true, pub: args[1], roles })
            return
        }
        if (sub === "role") {
            write(setRoles(identities, args[1], roles))
            out.print(`${out.green("✓")} ${String(args[1]).slice(0, 12)}… → ${out.cyan(roles.join(", ") || "no roles")}`)
            out.emit({ ok: true, pub: args[1], roles })
            return
        }
        if (sub === "remove") {
            write(removeUser(identities, args[1]))
            out.print(`${out.green("✓")} removed ${String(args[1]).slice(0, 12)}…`)
            out.emit({ ok: true, pub: args[1] })
            return
        }
        out.error(`Unknown: nexus user ${sub} (use list|add|role|remove)`, { code: "E_USAGE" })
        process.exitCode = 2
    } catch (error) {
        out.error(error.message, { code: error.message.split(":")[0] })
        process.exitCode = 1
    }
}

export default user
