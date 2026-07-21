/**
 * nexus doctor — instance diagnosis (§5.2, the bench-doctor coverage):
 * runtime version, instance validity, extensions, database reachability,
 * per-entity tables, pending migrations. Exit 0 healthy / 1 findings.
 */

import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { loadInstance, CORE_VERSION } from "../instance.js"
import { loadExtensions } from "../../core/App/extensions.js"
import { openInstanceData } from "../data.js"
import { appliedMigrations } from "../../core/Data/migrate.js"

export async function doctor(args, flags, out) {
    const root = process.cwd()
    const checks = []
    const check = (name, ok, note = "") => checks.push({ name, ok, note })

    const [major] = process.versions.node.split(".").map(Number)
    check("node >= 18", major >= 18, `running ${process.versions.node}`)
    check("nexus core", true, `v${CORE_VERSION}`)

    if (!existsSync(join(root, "nexus.config.json"))) {
        check("instance", false, "no nexus.config.json here")
    } else {
        let instance = null
        try {
            instance = loadInstance(root)
            check("schemas + manifests", true, `${instance.schemas.length} entities, ${instance.apps.length} apps`)
        } catch (error) {
            check("schemas + manifests", false, error.message)
        }
        if (instance) {
            try {
                const extensions = await loadExtensions(root, instance.apps)
                check("extensions", true, `${extensions.endpoints.length} endpoints, ${extensions.commands.size} commands`)
            } catch (error) {
                check("extensions", false, error.message)
            }
            try {
                const { executor } = await openInstanceData(root, instance.config)
                // What the engine is ACTUALLY running under, not what was
                // configured: a pragma that was sent and ignored is the failure
                // mode worth showing an operator (ADP-WAL-*).
                if (executor.dialect === "sqlite")
                    try {
                        const journal = (await executor.all(`PRAGMA journal_mode`))[0]?.journal_mode
                        const busy = (await executor.all(`PRAGMA busy_timeout`))[0]?.timeout
                        check("sqlite concurrency", journal === "wal" || journal === "memory", `journal_mode=${journal}, busy_timeout=${busy}ms`)
                    } catch (error) {
                        check("sqlite concurrency", false, error.message)
                    }
                for (const schema of instance.schemas) {
                    try {
                        await executor.all(`SELECT 1 FROM "${schema.name}" LIMIT 1`)
                        check(`table ${schema.name}`, true)
                    } catch {
                        check(`table ${schema.name}`, false, "missing — run nexus migrate --apply")
                    }
                }
                const done = new Set((await appliedMigrations(executor)).map((m) => m.id))
                const migrationsDir = join(root, "migrations")
                const pending = existsSync(migrationsDir)
                    ? readdirSync(migrationsDir).filter((f) => {
                          if (!f.endsWith(".json")) return false
                          return !done.has(JSON.parse(readFileSync(join(migrationsDir, f), "utf8")).id)
                      })
                    : []
                check("migrations", pending.length === 0, pending.length ? `${pending.length} pending — review then nexus migrate --apply` : "ledger clean")
                if (executor.close) executor.close()
            } catch (error) {
                check("database", false, error.message)
            }
        }
    }

    const failed = checks.filter((c) => !c.ok)
    for (const c of checks)
        out.print(`  ${c.ok ? out.green("✓") : out.red("✗")} ${c.name}${c.note ? out.dim(` — ${c.note}`) : ""}`)
    out.print("")
    out.print(failed.length ? out.red(`  ${failed.length} finding${failed.length === 1 ? "" : "s"}`) : out.green("  healthy"))
    out.emit({ ok: failed.length === 0, checks })
    if (failed.length) process.exitCode = 1
}
