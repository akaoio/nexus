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

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync, createWriteStream } from "fs"
import { join, dirname } from "path"
import { loadInstance } from "../instance.js"
import { openInstanceData, ensureTables } from "../data.js"
import { appliedMigrations, ensureLedger } from "../../core/Data/migrate.js"
import { restorableRow } from "../../core/Model.js"
import { SYSTEM_ENTITIES } from "../../core/App/system.js"
import { redact } from "../../core/App/config.js"

const BACKUP_VERSION = 1
const quote = (name) => `"${String(name).replace(/"/g, '""')}"` // SEC: double embedded quotes

/** Row columns that hold credentials and must never ride a backup in the clear.
 *  Declared per entity so a new secret-bearing column is a deliberate edit here,
 *  not an oversight (issue #9 C3 follow-through). */
const SECRET_COLUMNS = Object.freeze({
    nexus_webhook: ["secret"],
    nexus_job: ["lease_token"]
})

/** Mask any declared secret columns on every row of this entity, in place. */
function maskSecretColumns(entityName, rows) {
    const columns = SECRET_COLUMNS[entityName]
    if (!columns || !rows) return rows
    for (const row of rows) for (const column of columns) if (row[column] != null) row[column] = "***"
    return rows
}

/** A missing table is tolerable only for a SYSTEM entity — an older instance
 *  may predate it; anything else (permission, I/O, corruption) is not.
 *  Bare "does not exist" is Postgres's phrasing for a missing relation, but
 *  the SAME phrase also shows up in a permission-scoped message like
 *  "relation X does not exist for role Y" — there the relation EXISTS, it is
 *  merely invisible to that role/session (a permission fault we must NOT
 *  swallow), not a version-skew missing table. Excluding "…does not exist
 *  for role…" specifically (rather than requiring an engine error code,
 *  which not every driver here exposes) keeps the common no-such-table
 *  phrasings while refusing that one ambiguous shape. */
const isMissingTableError = (error) => {
    const message = String(error?.message ?? "")
    if (/no such table|doesn't exist|Unknown table/i.test(message)) return true
    return /does not exist/i.test(message) && !/does not exist\s+for\s+role/i.test(message)
}

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

    // back up the SAME set the server composes — app schemas plus the system
    // entities, or a restore returns data nobody can log in to (issue #9 C3)
    const backupSchemas = [...schemas, ...SYSTEM_ENTITIES]
    const file = args[1] ?? `backup-${Date.now()}.json`
    const target = join(root, file)

    // STREAMED, in pages (issue #9's backup-memory moderate). The document
    // used to be assembled whole in memory — every row of every table — and
    // the security chunk made that strictly worse by adding the system
    // entities to it. Peak memory is now one page, and the DOCUMENT is
    // unchanged: same keys, same values, restore reads it as before. Only the
    // whitespace differs (one row per line), which is not part of the
    // round-trip contract and is easier to diff besides.
    const stream = createWriteStream(target)
    const write = (text) =>
        new Promise((done, failed) => {
            if (stream.write(text)) return done()
            stream.once("drain", done)
            stream.once("error", failed)
        })

    const PAGE = 500
    const captured = []
    const skipped = []
    let rows = 0

    await write("{\n")
    await write(`  "backupVersion": ${JSON.stringify(BACKUP_VERSION)},\n`)
    await write(`  "createdAt": ${JSON.stringify(new Date().toISOString())},\n`)
    await write(`  "config": ${JSON.stringify(redact(config))},\n`)
    // restore must re-supply token_secret / api_keys / webhook secrets
    await write(`  "secretsRedacted": true,\n`)
    await write(`  "apps": ${JSON.stringify(appFiles)},\n`)
    await write(`  "data": {\n`)

    for (const schema of backupSchemas) {
        const name = schema.name
        const system = SYSTEM_ENTITIES.some((s) => s.name === name)
        // App tables: fail loudly — ensureTables above guarantees they exist,
        // so a read error is a real fault (permissions, I/O, corruption), not
        // something to swallow and report as a clean, if incomplete, backup.
        // A SYSTEM table may genuinely be absent on an instance no server has
        // booted yet; that is tolerable, but it is NAMED rather than silently
        // dropped while the summary counts it (SITE-COUNT-01).
        let opened = false // has this entity's array been started?
        let firstRow = true
        const openEntity = async () => {
            if (opened) return
            await write(`${captured.length ? ",\n" : ""}    ${JSON.stringify(name)}: [`)
            captured.push(name)
            opened = true
        }
        try {
            for (let offset = 0; ; offset += PAGE) {
                const page = await executor.all(
                    `SELECT * FROM ${quote(name)} ORDER BY id LIMIT ${PAGE} OFFSET ${offset}`
                )
                // The FIRST read is what proves the table exists, so the array
                // is opened only after it succeeds — a missing system table
                // must not leave a half-written key behind.
                await openEntity()
                if (!page.length) break
                maskSecretColumns(name, page)
                for (const row of page) {
                    await write(`${firstRow ? "\n      " : ",\n      "}${JSON.stringify(row)}`)
                    firstRow = false
                    rows++
                }
                if (page.length < PAGE) break
            }
        } catch (error) {
            if (!system || !isMissingTableError(error)) throw error
            skipped.push(name)
            continue
        }
        await write(firstRow ? "]" : "\n    ]")
    }

    await write("\n  },\n")
    await write(`  "migrations": ${JSON.stringify(await appliedMigrations(executor))}\n`)
    await write("}\n")
    await new Promise((done, failed) => { stream.end(); stream.once("finish", done); stream.once("error", failed) })

    out.print(`${out.green("✓")} Backed up ${captured.length} entities, ${rows} rows → ${out.cyan(file)}`)
    if (skipped.length)
        out.print(out.yellow(`  not present on this instance, so not backed up: ${skipped.join(", ")}`))
    out.print(out.yellow("  secrets redacted — token_secret, API keys and webhook signing secrets must be re-supplied after restore"))
    out.emit({ ok: true, file, entities: captured.length, rows, skipped, secretsRedacted: true })
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
    // the backup's config rows AND row-level secrets never carry the real
    // value (issue #9 C3) — a restored "***" must never be mistaken for a
    // working token_secret/key or a live webhook signing secret
    if (document.secretsRedacted)
        out.print(out.yellow("  ⚠ this backup's secrets were redacted — re-supply token_secret and api_keys[].key (nexus config set …), and nexus_webhook.secret for each webhook, before this instance can serve"))
    out.emit({ ok: true, apply, secretsRedacted: document.secretsRedacted === true, ...report })
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
