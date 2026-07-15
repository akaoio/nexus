/**
 * Migration Engine runtime — Model.diff classifications become real DDL
 * (ARCHITECTURE.md §4.4, the hybrid model).
 *
 * Two paths, one safety boundary:
 *
 *  HOT (plan → hotApply): only changes this dialect can apply live without
 *  a table rebuild — adding columns (nullable, or required-with-default),
 *  creating/dropping indexes, and metadata-only changes (labels, extended
 *  select options, defaults, permlevels, semantic). Anything classified
 *  structural throws E_STRUCTURAL; anything additive-in-semantics that this
 *  dialect cannot do hot (e.g. dropping NOT NULL or UNIQUE on sqlite)
 *  throws E_NOT_HOT — the engine never pretends.
 *
 *  STRUCTURAL (migrationPlan → applyMigration): a reviewable migration
 *  document with the human-declared `renames` map — the disambiguation
 *  Model.diff refuses to guess (MS-D06): a rename preserves data, drop+add
 *  loses it, and only a person knows which was meant. Applied via the
 *  universal rebuild strategy (temp table → copy → swap → indexes) inside
 *  one transaction, on every engine alike. dryRun (the default) executes
 *  everything, measures impact — rows copied, non-null values lost per
 *  dropped column — then ROLLS BACK.
 *
 *  The ledger (_nexus_migrations, Frappe's patches.txt lesson) records
 *  applied migrations: never re-run, replayable on a fresh instance.
 *
 * Defaults note: the authoritative default lives in the schema and is
 * applied by the Data Plane at insert time; the DB-level DEFAULT is a
 * convenience for out-of-band inserts and may lag behind hot metadata
 * changes until the next rebuild.
 *
 * The executor interface — { run(sql, params?), all(sql, params?) } — is
 * deliberately minimal; it is the seed of the engine adapter contract.
 */

import { validate, diff, SYSTEM_FIELDS } from "../model/Model.js"
import { sha256 } from "../kernel/Utils.js"
import { DIALECT_NAMES } from "./kysely.js"
import { tableDDL, columnType } from "./ddl.js"

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)
const clone = (x) => JSON.parse(JSON.stringify(x))
const quote = (name) => `"${name}"`
const fieldMap = (schema) => new Map(schema.fields.map((f) => [f.name, f]))

const METADATA_ONLY = new Set(["label", "default", "permlevel", "options"])
const indexName = (entity, fields) => `idx_${entity}_${fields.join("_")}`

function checkInputs(oldSchema, newSchema, dialect) {
    if (!DIALECT_NAMES.includes(dialect)) throw err("E_DIALECT", `unknown dialect "${dialect}"`)
    for (const schema of [oldSchema, newSchema]) {
        const result = validate(schema)
        if (!result.valid) throw err("E_INVALID", JSON.stringify(result.errors))
    }
    if (oldSchema.name !== newSchema.name)
        throw err("E_ENTITY", "schemas describe different entities — migrations are per entity")
}

// ─── HOT path ─────────────────────────────────────────────────────────────────

/**
 * Classify the change set and build the hot statements this dialect can run
 * live. Never executes anything.
 * @returns {{changes, hot: Array<{change, statements}>, deferred, structural, isHot: boolean}}
 */
export function plan(kysely, oldSchema, newSchema, options = {}) {
    const dialect = options.dialect ?? "sqlite"
    checkInputs(oldSchema, newSchema, dialect)
    const changes = diff(oldSchema, newSchema)
    const oldFields = fieldMap(oldSchema)
    const newFields = fieldMap(newSchema)
    const table = newSchema.name

    const hot = []
    const deferred = []
    const structural = []

    for (const change of changes) {
        if (change.class === "structural") {
            structural.push(change)
            continue
        }

        // Added field: nullable, or required-with-default — hot on every engine
        if (change.change === "added") {
            const field = newFields.get(change.field)
            const statements = [
                kysely.schema
                    .alterTable(table)
                    .addColumn(field.name, columnType(field.type, dialect), (col) => {
                        if (field.required === true) col = col.notNull()
                        if ("default" in field) col = col.defaultTo(field.default)
                        return col
                    })
                    .compile()
            ]
            if (field.type === "link")
                statements.push(kysely.schema.createIndex(indexName(table, [field.name])).on(table).column(field.name).compile())
            hot.push({ change, statements })
            continue
        }

        // Index set changes: create the new, drop the removed
        if (change.change === "indexes") {
            const statements = []
            const oldNames = new Map((oldSchema.indexes ?? []).map((i) => [indexName(table, i.fields), i]))
            const newNames = new Map((newSchema.indexes ?? []).map((i) => [indexName(table, i.fields), i]))
            for (const [name, index] of newNames)
                if (!oldNames.has(name)) statements.push(kysely.schema.createIndex(name).on(table).columns(index.fields).compile())
            for (const name of oldNames.keys())
                if (!newNames.has(name)) statements.push(kysely.schema.dropIndex(name).compile())
            hot.push({ change, statements })
            continue
        }

        // Field property changes: metadata-only → no DDL; anything touching
        // constraints (required loosening, unique drop) is not hot on sqlite
        if (change.field) {
            const props = change.change.split(",")
            if (props.every((p) => METADATA_ONLY.has(p))) {
                hot.push({ change, statements: [] })
                continue
            }
            deferred.push(change)
            continue
        }

        // Entity-level metadata (label, semantic)
        hot.push({ change, statements: [] })
    }

    return { changes, hot, deferred, structural, isHot: structural.length === 0 && deferred.length === 0 }
}

/**
 * Apply a fully-hot change set live. Refuses loudly when anything requires
 * the structural path (E_STRUCTURAL) or a rebuild on this dialect (E_NOT_HOT).
 * @returns {{applied: number, statements: number}}
 */
export async function hotApply(executor, kysely, oldSchema, newSchema, options = {}) {
    const p = plan(kysely, oldSchema, newSchema, options)
    if (p.structural.length)
        throw err("E_STRUCTURAL", `requires a migration: ${p.structural.map((c) => c.field ?? c.change).join(", ")}`)
    if (p.deferred.length)
        throw err("E_NOT_HOT", `requires a rebuild on this dialect: ${p.deferred.map((c) => `${c.field}(${c.change})`).join(", ")}`)
    let statements = 0
    for (const entry of p.hot)
        for (const compiled of entry.statements) {
            await executor.run(compiled.sql, [...compiled.parameters])
            statements++
        }
    return { applied: p.hot.length, statements }
}

// ─── STRUCTURAL path ──────────────────────────────────────────────────────────

/**
 * Generate a reviewable migration document from two schemas. Deterministic:
 * the same inputs produce the same id. `renames` is the human's edit —
 * { oldField: newField } — declaring intent the diff cannot guess.
 */
export function migrationPlan(oldSchema, newSchema, { renames = {} } = {}) {
    checkInputs(oldSchema, newSchema, "sqlite")
    for (const [from, to] of Object.entries(renames)) {
        if (!fieldMap(oldSchema).has(from)) throw err("E_RENAME", `unknown source field "${from}"`)
        if (!fieldMap(newSchema).has(to)) throw err("E_RENAME", `unknown target field "${to}"`)
    }
    const checksum = sha256(JSON.stringify({ from: oldSchema, to: newSchema, renames }))
    return {
        migrationVersion: 1,
        id: `${newSchema.name}_${checksum.slice(0, 12)}`,
        entity: newSchema.name,
        changes: diff(oldSchema, newSchema),
        renames,
        from: clone(oldSchema),
        to: clone(newSchema),
        checksum
    }
}

export async function ensureLedger(executor) {
    await executor.run(
        `CREATE TABLE IF NOT EXISTS _nexus_migrations (id TEXT PRIMARY KEY, entity TEXT, checksum TEXT, applied_at TEXT)`
    )
}

export async function appliedMigrations(executor) {
    await ensureLedger(executor)
    return executor.all(`SELECT id, entity, checksum, applied_at FROM _nexus_migrations ORDER BY applied_at`)
}

/**
 * Execute a migration via the universal rebuild inside ONE transaction:
 * temp table → mapped copy (renames honoured) → swap → indexes. dryRun
 * (default) measures impact and ROLLS BACK; a real apply records the ledger.
 * Idempotent: an already-applied id is skipped.
 * @returns {{dryRun, alreadyApplied?, report?: {copied, lost}}}
 */
export async function applyMigration(executor, kysely, migration, options = {}) {
    const dialect = options.dialect ?? "sqlite"
    const dryRun = options.dryRun !== false // dry-run is the DEFAULT (§4.4)
    if (migration?.migrationVersion !== 1) throw err("E_VERSION_UNKNOWN", `migrationVersion ${migration?.migrationVersion}`)
    checkInputs(migration.from, migration.to, dialect)

    await ensureLedger(executor)
    const existing = await executor.all(`SELECT id FROM _nexus_migrations WHERE id = ?`, [migration.id])
    if (existing.length) return { dryRun, alreadyApplied: true }

    const entity = migration.entity
    const temp = `${entity}__migrating`
    const from = fieldMap(migration.from)
    const renameSource = Object.fromEntries(Object.entries(migration.renames ?? {}).map(([o, n]) => [n, o]))

    // Column mapping: destination ← source (renames win; dropped fields vanish)
    const destinations = [...SYSTEM_FIELDS, ...migration.to.fields.filter((f) => f.type !== "table").map((f) => f.name)]
    const pairs = destinations
        .map((dest) => {
            const source = renameSource[dest] ?? (SYSTEM_FIELDS.includes(dest) || from.has(dest) ? dest : null)
            return source === null ? null : { dest, source }
        })
        .filter(Boolean)

    // Impact: non-null values in columns that are dropped (not renamed away)
    const renamedAway = new Set(Object.keys(migration.renames ?? {}))
    const dropped = [...from.keys()].filter(
        (name) => !renamedAway.has(name) && !migration.to.fields.some((f) => f.name === name)
    )

    await executor.run(`DROP TABLE IF EXISTS ${quote(temp)}`)
    await executor.run("BEGIN")
    try {
        const lost = {}
        for (const column of dropped) {
            const [row] = await executor.all(`SELECT COUNT(*) AS n FROM ${quote(entity)} WHERE ${quote(column)} IS NOT NULL`)
            lost[column] = row.n
        }

        // 1) temp table with the target shape (indexes come after the swap)
        const [createTemp] = tableDDL(kysely, { ...clone(migration.to), name: temp, indexes: [] }, { dialect })
        await executor.run(createTemp.compile().sql)

        // 2) mapped copy
        const destList = pairs.map((p) => quote(p.dest)).join(", ")
        const sourceList = pairs.map((p) => quote(p.source)).join(", ")
        await executor.run(`INSERT INTO ${quote(temp)} (${destList}) SELECT ${sourceList} FROM ${quote(entity)}`)
        const [count] = await executor.all(`SELECT COUNT(*) AS n FROM ${quote(temp)}`)

        // 3) swap + indexes under their final names
        await executor.run(`DROP TABLE ${quote(entity)}`)
        await executor.run(`ALTER TABLE ${quote(temp)} RENAME TO ${quote(entity)}`)
        const [, ...indexBuilders] = tableDDL(kysely, migration.to, { dialect })
        for (const builder of indexBuilders) await executor.run(builder.compile().sql)

        const report = { copied: count.n, lost }
        if (dryRun) {
            await executor.run("ROLLBACK")
            return { dryRun: true, report }
        }
        await executor.run(`INSERT INTO _nexus_migrations (id, entity, checksum, applied_at) VALUES (?, ?, ?, ?)`, [
            migration.id,
            entity,
            migration.checksum,
            new Date().toISOString()
        ])
        await executor.run("COMMIT")
        return { dryRun: false, report }
    } catch (error) {
        await executor.run("ROLLBACK")
        throw error
    }
}

export default { plan, hotApply, migrationPlan, applyMigration, ensureLedger, appliedMigrations }
