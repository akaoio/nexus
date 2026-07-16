/**
 * nexus app new|list — app lifecycle at the CLI (§5.2 / §8.1).
 * new <name>: scaffold apps/<name>/ (manifest + models/ + hooks.js stub);
 * refuses an existing directory. list: every app with its manifest and
 * entity count.
 */

import { existsSync, readdirSync, mkdirSync, writeFileSync } from "fs"
import { join } from "path"
import { loadInstance } from "../instance.js"

const NAME_RE = /^[a-z][a-z0-9_-]*$/

export async function app(args, flags, out) {
    const root = process.cwd()
    if (!existsSync(join(root, "nexus.config.json"))) {
        out.error("Not a Nexus instance (no nexus.config.json here)", { code: "E_NO_INSTANCE" })
        process.exitCode = 1
        return
    }
    const sub = args[0]

    if (sub === "new") {
        const name = args[1]
        if (!name || !NAME_RE.test(name)) {
            out.error("Usage: nexus app new <name>  (lowercase, digits, _ or -)", { code: "E_USAGE" })
            process.exitCode = 2
            return
        }
        const dir = join(root, "apps", name)
        if (existsSync(dir)) {
            out.error(`App already exists: apps/${name}`, { code: "E_EXISTS" })
            process.exitCode = 1
            return
        }
        mkdirSync(join(dir, "models"), { recursive: true })
        writeFileSync(join(dir, "manifest.json"), JSON.stringify({ manifestVersion: 1, name, version: "0.1.0" }, null, 4) + "\n")
        writeFileSync(join(dir, "hooks.js"), `export default ({ hook, endpoint, command }) => {\n    // hook("entity", "before:create", (payload, ctx) => {})\n}\n`)
        out.print(`${out.green("✓")} Created app ${out.bold(name)} — add models under apps/${name}/models/`)
        out.emit({ ok: true, name, created: [`apps/${name}/manifest.json`, `apps/${name}/hooks.js`] })
        return
    }

    if (sub === "list") {
        const { apps } = loadInstance(root)
        const rows = apps.map(({ dir, manifest }) => {
            const modelsDir = join(root, "apps", dir, "models")
            const entities = existsSync(modelsDir) ? readdirSync(modelsDir).filter((f) => f.endsWith(".json")).length : 0
            return { dir, name: manifest.name, version: manifest.version, entities }
        })
        for (const row of rows) out.print(`  ${out.bold(row.name)}@${row.version} ${out.dim(`(apps/${row.dir}, ${row.entities} entities)`)}`)
        if (!rows.length) out.print(out.dim("  no apps"))
        out.emit({ ok: true, apps: rows })
        return
    }

    out.error("Usage: nexus app new <name> | nexus app list", { code: "E_USAGE" })
    process.exitCode = 2
}
