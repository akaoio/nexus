/**
 * nexus doctor — diagnosis at TWO scopes, one command (issue #8 answer 4).
 *
 * Inside an instance: instance validity, extensions, database reachability,
 * per-entity tables, pending migrations — unchanged.
 *
 * Outside one, or with --install: the INSTALLATION itself — channel, home,
 * shims and whether they are on PATH, when it last updated. Nothing could
 * answer "when was the framework last updated, and through which channel?"
 * before this.
 *
 * One command rather than two, because §5.2 keeps the CLI surface small and
 * two commands means knowing which to run before knowing what is wrong. Scope
 * follows cwd, the convention `nexus dev` already uses.
 *
 * Exit 0 healthy / 1 findings.
 */

import { existsSync, readFileSync, readdirSync } from "fs"
import { join } from "path"
import { loadInstance, CORE_VERSION } from "../instance.js"
import { loadExtensions } from "../../core/App/extensions.js"
import { openInstanceData } from "../data.js"
import { appliedMigrations } from "../../core/Data/migrate.js"
import { readManifest, readUpdateRecord } from "../install-state.js"
import { studioBuildStatus } from "../studio-stamp.js"
import { fileURLToPath } from "url"
import { dirname } from "path"

const NEXUS_ROOT = fileURLToPath(new URL("../../..", import.meta.url))

/** Install-scope checks: what this copy of Nexus IS, not what an instance holds. */
function installChecks(check) {
    let manifest = null
    try {
        manifest = readManifest(NEXUS_ROOT)
    } catch (error) {
        check("install manifest", false, error.message)
    }
    const channel = manifest?.channel
        ?? (NEXUS_ROOT.includes("node_modules") ? "npm" : existsSync(join(NEXUS_ROOT, ".git")) ? "git" : "tarball")
    check("install", true, `${channel} · ${manifest?.commit ? manifest.commit.slice(0, 12) + " · " : ""}${NEXUS_ROOT}`)
    check("install manifest", Boolean(manifest),
        manifest ? `${manifest.shims.length} shim(s) recorded` : "absent — uninstall falls back to the default locations")

    // A shim that exists but whose directory is not on PATH is the failure an
    // operator meets as "command not found" and has no way to diagnose.
    const pathDirs = (process.env.PATH ?? "").split(":")
    for (const shim of manifest?.shims ?? []) {
        const there = existsSync(shim)
        const onPath = pathDirs.includes(dirname(shim))
        check(`shim ${shim}`, there && onPath, !there ? "missing" : onPath ? "on PATH" : "present, but its directory is NOT on PATH")
    }

    let update = null
    try {
        update = readUpdateRecord(NEXUS_ROOT)
    } catch (error) {
        check("last update", false, error.message)
    }
    check("last update", true,
        update ? `${update.at} · ${update.channel} · ${update.commit ?? "?"}` : "never recorded (updated before this was tracked, or never)")
}

export async function doctor(args, flags, out) {
    const root = process.cwd()
    const checks = []
    const check = (name, ok, note = "") => checks.push({ name, ok, note })

    const [major] = process.versions.node.split(".").map(Number)
    check("node >= 18", major >= 18, `running ${process.versions.node}`)
    check("nexus core", true, `v${CORE_VERSION}`)

    const inInstance = existsSync(join(root, "nexus.config.json"))
    // --install forces install scope even inside an instance; outside one it is
    // the only sensible scope, so it is implied rather than demanded.
    if (flags.install === true || !inInstance) installChecks(check)

    if (!inInstance) {
        if (flags.install !== true) check("instance", false, "no nexus.config.json here — reporting the INSTALL instead")
    } else if (flags.install === true) {
        // install scope was asked for explicitly; the instance half is skipped
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

                // The built Studio, if there is one. A built tree is a copy of
                // the framework's src/studio/** with this instance's schemas
                // baked into its shell, and both move underneath it — `nexus
                // update` replaces the framework, editing a model replaces the
                // schemas. Neither is visible from the built tree itself, which
                // is exactly the kind of question doctor exists to answer.
                //
                // Not a FINDING when absent: an instance is entitled to have no
                // admin UI in production, and most should not (the shell serves
                // at the site root, pre-login, with schemas baked in).
                const studio = studioBuildStatus({ instanceRoot: root, frameworkRoot: NEXUS_ROOT, schemas: instance.schemas })
                if (!studio.built) check("studio build", true, "none — `nexus studio build` adds an admin UI under `nexus start`")
                else check("studio build", !studio.stale, studio.stale ? studio.reasons.join(" · ") + " — rebuild with `nexus studio build`" : "matches this instance")
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
