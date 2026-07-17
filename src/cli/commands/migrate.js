/**
 * nexus migrate [--apply] — the Migration Engine at the command line (§4.4).
 *
 * Baseline: .nexus/schemas.json — the snapshot of schemas as last applied.
 * Against it, every entity's current schema is planned:
 *   hot        — additive changes this dialect applies live
 *   migration  — structural (or dialect-deferred) changes: a reviewable
 *                migration file is GENERATED into migrations/<id>.json
 *                (generation is safe and happens even in preview — that IS
 *                the review workflow; edit its `renames` before applying)
 *   removed    — entities that vanished from disk are REPORTED ONLY; the
 *                engine never drops a table on its own
 *
 * Preview is the DEFAULT. --apply executes: hot DDL + pending migration
 * files (through the ledger — idempotent) + snapshot update. Every pending
 * migration is dry-run first even under --apply; its impact report prints
 * before the real run.
 */

import { existsSync, readFileSync, writeFileSync, readdirSync, mkdirSync } from "fs"
import { join } from "path"
import { loadInstance } from "../instance.js"
import { openInstanceData, ensureTables } from "../data.js"
import { plan, hotApply, migrationPlan, applyMigration, appliedMigrations, ensureLedger } from "../../core/Data/migrate.js"
import { tableDDL } from "../../core/Data/ddl.js"

export async function migrate(args, flags, out) {
    const root = process.cwd()
    if (!existsSync(join(root, "nexus.config.json"))) {
        out.error("Not a Nexus instance (no nexus.config.json here)", { code: "E_NO_INSTANCE" })
        process.exitCode = 1
        return
    }
    const apply = flags.apply === true
    const { config, schemas } = loadInstance(root)
    const { executor, kysely, dialect } = await openInstanceData(root, config)
    await ensureLedger(executor)

    const snapshotPath = join(root, ".nexus", "schemas.json")
    const snapshot = existsSync(snapshotPath) ? JSON.parse(readFileSync(snapshotPath, "utf8")) : null
    const report = { bootstrap: false, hot: [], generated: [], applied: [], removed: [], pending: [] }

    if (snapshot === null) {
        // First run: ensure every table, then snapshot
        report.bootstrap = true
        if (apply) {
            await ensureTables(executor, kysely, schemas, dialect)
            mkdirSync(join(root, ".nexus"), { recursive: true })
            writeFileSync(snapshotPath, JSON.stringify(schemas, null, 4))
        }
        out.print(apply
            ? `${out.green("✓")} Bootstrapped ${schemas.length} entities and wrote the baseline snapshot`
            : `Would bootstrap ${schemas.length} entities ${out.dim("(preview — run with --apply)")}`)
        out.emit({ ok: true, ...report, entities: schemas.length, applied: apply ? schemas.map((s) => s.name) : [] })
        return
    }

    const byName = new Map(snapshot.map((s) => [s.name, s]))
    mkdirSync(join(root, "migrations"), { recursive: true })

    for (const schema of schemas) {
        const baseline = byName.get(schema.name)
        if (!baseline) {
            report.hot.push({ entity: schema.name, change: "new entity" })
            if (apply) await ensureTables(executor, kysely, [schema], dialect)
            continue
        }
        const p = plan(kysely, baseline, schema, { dialect })
        if (!p.changes.length) continue
        if (p.isHot) {
            report.hot.push({ entity: schema.name, changes: p.changes.length })
            if (apply) await hotApply(executor, kysely, baseline, schema, { dialect })
        } else {
            const migration = migrationPlan(baseline, schema)
            const file = join(root, "migrations", `${migration.id}.json`)
            if (!existsSync(file)) {
                writeFileSync(file, JSON.stringify(migration, null, 4))
                report.generated.push(`migrations/${migration.id}.json`)
            }
        }
    }
    for (const [name] of byName)
        if (!schemas.some((s) => s.name === name))
            report.removed.push({ entity: name, note: "vanished from disk — the engine never drops tables; migrate manually" })

    // Pending migration files (ledger-gated, idempotent)
    const done = new Set((await appliedMigrations(executor)).map((m) => m.id))
    for (const entry of readdirSync(join(root, "migrations")).filter((f) => f.endsWith(".json"))) {
        const migration = JSON.parse(readFileSync(join(root, "migrations", entry), "utf8"))
        if (done.has(migration.id)) continue
        const dry = await applyMigration(executor, kysely, migration, { dialect }) // dry-run always first
        report.pending.push({ file: `migrations/${entry}`, id: migration.id, impact: dry.report })
        if (apply) {
            await applyMigration(executor, kysely, migration, { dialect, dryRun: false })
            report.applied.push(migration.id)
        }
    }

    if (apply) writeFileSync(snapshotPath, JSON.stringify(schemas, null, 4))

    for (const h of report.hot) out.print(`  ${out.green("hot")} ${h.entity} ${out.dim(h.change ?? `${h.changes} changes`)}`)
    for (const g of report.generated) out.print(`  ${out.yellow("generated")} ${g} ${out.dim("(review renames, then --apply)")}`)
    for (const p of report.pending)
        out.print(`  ${out.yellow("migration")} ${p.id} ${out.dim(`copies ${p.impact.copied} rows; loses ${JSON.stringify(p.impact.lost)}`)}`)
    for (const r of report.removed) out.print(`  ${out.red("removed")} ${r.entity} ${out.dim(r.note)}`)
    if (!report.hot.length && !report.generated.length && !report.pending.length && !report.removed.length)
        out.print(out.dim("  nothing to migrate"))
    out.print(apply ? out.green("  applied") : out.dim("  preview only — run with --apply"))
    out.emit({ ok: true, ...report, apply })
    if (executor.close) executor.close()
}
