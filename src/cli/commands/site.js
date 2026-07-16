/**
 * nexus site backup|restore — the round-trip contract of §4.4 at the CLI.
 *
 * backup [file]: one JSON document — config, every app's files (manifest,
 * models, hooks.js), every entity's rows, and the migration ledger.
 *
 * restore <file> [--apply]: STRICTLY ADDITIVE, the anti-`strapi import`:
 *   - app files are written only where the app directory does not exist
 *   - rows insert only when their id is absent — existing data is NEVER
 *     deleted or overwritten
 *   - ledger entries merge so applied migrations never re-run
 * Preview is the default; --apply executes. Restoring twice is a no-op.
 * (v1 restores into the same engine family — raw storage values copy as-is.)
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs"
import { join, dirname } from "path"
import { loadInstance } from "../instance.js"
import { openInstanceData, ensureTables } from "../data.js"
import { appliedMigrations, ensureLedger } from "../../data/migrate.js"
import { restorableRow } from "../../model/Model.js"

const BACKUP_VERSION = 1
const quote = (name) => `"${name}"`

async function backup(args, flags, out, root) {
    const { config, schemas, apps } = loadInstance(root)
    const { executor, kysely, dialect } = await openInstanceData(root, config)
    await ensureTables(executor, kysely, schemas, dialect)

    const appFiles = {}
    for (const app of apps) {
        const dir = join(root, "apps", app.dir)
        const files = { "manifest.json": readFileSync(join(dir, "manifest.json"), "utf8") }
        const modelsDir = join(dir, "models")
        if (existsSync(modelsDir))
            for (const entry of readdirSync(modelsDir))
                files[`models/${entry}`] = readFileSync(join(modelsDir, entry), "utf8")
        if (existsSync(join(dir, "hooks.js"))) files["hooks.js"] = readFileSync(join(dir, "hooks.js"), "utf8")
        appFiles[app.dir] = files
    }

    const data = {}
    for (const schema of schemas) data[schema.name] = await executor.all(`SELECT * FROM ${quote(schema.name)}`)
    const document = {
        backupVersion: BACKUP_VERSION,
        createdAt: new Date().toISOString(),
        config,
        apps: appFiles,
        data,
        migrations: await appliedMigrations(executor)
    }
    const file = args[1] ?? `backup-${Date.now()}.json`
    writeFileSync(join(root, file), JSON.stringify(document, null, 2))
    const rows = Object.values(data).reduce((n, list) => n + list.length, 0)
    out.print(`${out.green("✓")} Backed up ${schemas.length} entities, ${rows} rows → ${out.cyan(file)}`)
    out.emit({ ok: true, file, entities: schemas.length, rows })
    if (executor.close) executor.close()
}

async function restore(args, flags, out, root) {
    const file = args[1]
    if (!file || !existsSync(join(root, file))) {
        out.error("Usage: nexus site restore <backup.json> [--apply]", { code: "E_USAGE" })
        process.exitCode = 2
        return
    }
    const document = JSON.parse(readFileSync(join(root, file), "utf8"))
    if (document.backupVersion !== BACKUP_VERSION) {
        out.error(`Unknown backupVersion ${document.backupVersion}`, { code: "E_VERSION_UNKNOWN" })
        process.exitCode = 1
        return
    }
    const apply = flags.apply === true
    const report = { appsWritten: [], appsSkipped: [], inserted: {}, skipped: {}, rejected: {}, ledger: 0 }

    // App files — only where the app directory does not exist (never overwrite)
    for (const [dir, files] of Object.entries(document.apps ?? {})) {
        if (existsSync(join(root, "apps", dir))) {
            report.appsSkipped.push(dir)
            continue
        }
        report.appsWritten.push(dir)
        if (apply)
            for (const [relative, content] of Object.entries(files)) {
                const path = join(root, "apps", dir, relative)
                mkdirSync(dirname(path), { recursive: true })
                writeFileSync(path, content)
            }
    }

    // Rows — additive by id; the ledger merges the same way
    const { config, schemas } = apply ? loadInstance(root) : loadInstance(root)
    const { executor, kysely, dialect } = await openInstanceData(root, config)
    await ensureLedger(executor)
    if (apply) await ensureTables(executor, kysely, schemas, dialect)

    for (const [entity, rows] of Object.entries(document.data ?? {})) {
        report.inserted[entity] = 0
        report.skipped[entity] = 0
        report.rejected[entity] = 0
        const schema = schemas.find((s) => s.name === entity)
        for (const row of rows) {
            if (!schema) {
                report.skipped[entity]++ // the entity itself is gone from this instance
                continue
            }
            // Fit the row to the DESTINATION schema — dropped columns fall
            // away, required-without-default gaps reject; a backup from before
            // a schema change restores what it can, additively, never crashing.
            const fitted = restorableRow(schema, row)
            if (!fitted.valid) {
                report.rejected[entity]++
                continue
            }
            const existing = await executor.all(`SELECT id FROM ${quote(entity)} WHERE id = ?`, [row.id])
            if (existing.length) {
                report.skipped[entity]++
                continue
            }
            report.inserted[entity]++
            if (apply) {
                const compiled = kysely.insertInto(entity).values(fitted.row).compile()
                await executor.run(compiled.sql, [...compiled.parameters])
            }
        }
    }
    const done = new Set((await appliedMigrations(executor)).map((m) => m.id))
    for (const entry of document.migrations ?? [])
        if (!done.has(entry.id)) {
            report.ledger++
            if (apply)
                await executor.run(`INSERT INTO _nexus_migrations (id, entity, checksum, applied_at) VALUES (?, ?, ?, ?)`, [
                    entry.id, entry.entity, entry.checksum, entry.applied_at
                ])
        }

    const total = Object.values(report.inserted).reduce((a, b) => a + b, 0)
    const skipped = Object.values(report.skipped).reduce((a, b) => a + b, 0)
    const rejected = Object.values(report.rejected).reduce((a, b) => a + b, 0)
    out.print(`${apply ? out.green("✓ Restored") : "Would restore"}: ${total} rows inserted, ${skipped} already present ${out.dim("(never overwritten)")}${rejected ? out.yellow(`, ${rejected} rejected (incompatible with the current schema)`) : ""}`)
    if (report.appsWritten.length) out.print(`  apps written: ${report.appsWritten.join(", ")}`)
    if (report.appsSkipped.length) out.print(`  apps kept as-is: ${report.appsSkipped.join(", ")}`)
    if (!apply) out.print(out.dim("  preview only — run with --apply"))
    out.emit({ ok: true, apply, ...report })
    if (executor.close) executor.close()
}

export async function site(args, flags, out) {
    const root = process.cwd()
    if (!existsSync(join(root, "nexus.config.json"))) {
        out.error("Not a Nexus instance (no nexus.config.json here)", { code: "E_NO_INSTANCE" })
        process.exitCode = 1
        return
    }
    const sub = args[0]
    if (sub === "backup") return backup(args, flags, out, root)
    if (sub === "restore") return restore(args, flags, out, root)
    out.error("Usage: nexus site backup [file] | nexus site restore <file> [--apply]", { code: "E_USAGE" })
    process.exitCode = 2
}
