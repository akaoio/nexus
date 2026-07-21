/**
 * Entity lifecycle — the DELETE side. Removing an entity must leave the
 * instance CLEAN: its table and rows, its schema file, the policies that
 * point at it, its saved views, and every link column other entities aim
 * at it.
 *
 * Two tiers, the same plan→apply shape the Migration Engine uses:
 *
 *  - `entityDeletePlan` is PURE and complete, so the Studio can show a dry run
 *    and the human confirms by typing the entity's name — destruction is
 *    informed, never incidental.
 *  - `applyEntityDelete` performs exactly what the plan named, and nothing
 *    else. It lives here rather than inside the dev server's route handler
 *    because the dev server is imported by no test: as a route handler this
 *    code could only ever be observed as a black box, which is how it kept a
 *    non-atomic sequence and two swallowed errors for as long as it did
 *    (issue #9 I8).
 */

import { readFileSync, writeFileSync, rmSync, existsSync } from "fs"
import { join } from "path"
import { isSystem } from "./system.js"
import { capabilitiesFor } from "../Data/adapters.js"
import { transactionOf } from "../Data/transaction.js"

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

/**
 * Compute the full cascade plan for deleting `target`. Pure.
 * @param {Object} args
 * @param {string} args.target - entity name
 * @param {Array<{schema: Object, file: string}>} args.schemas - every loaded schema + its repo-relative file
 * @param {number} [args.rowCount=0] - rows currently in the table
 * @param {Array} [args.dbPolicyRows] - nexus_policy rows ({ id, entity })
 * @param {Array} [args.baselinePolicies] - file/nexus-shipped policies ({ entity, source })
 * @param {Array} [args.viewRows] - nexus_view rows ({ id, entity })
 * @returns {{entity, rowCount, schemaFile, dbPolicies, baselineOrphans, linkDrops, views, rolesAffected}}
 */
export function entityDeletePlan({ target, schemas = [], rowCount = 0, dbPolicyRows = [], baselinePolicies = [], viewRows = [] }) {
    if (isSystem(target)) throw err("E_SYSTEM_ENTITY", `"${target}" is system-owned and cannot be deleted`)
    const own = schemas.find((s) => s.schema.name === target)
    if (!own) throw err("E_UNKNOWN_ENTITY", `"${target}"`)

    // link columns in OTHER entities aiming at the target — they DROP, and so
    // does the index the DDL compiler creates for every link field
    // (`idx_<entity>_<field>`, ddl.js). Naming the index here is not
    // bookkeeping: sqlite refuses to drop a column an index still references,
    // so a cascade that dropped only the column failed EVERY time — silently,
    // while the schema file was rewritten to say the field was gone. The plan
    // is the dry run the operator approves, so it has to say this happens.
    const linkDrops = []
    for (const { schema, file } of schemas) {
        if (schema.name === target) continue
        for (const field of schema.fields ?? [])
            if (field.type === "link" && field.target === target)
                linkDrops.push({ entity: schema.name, field: field.name, file, index: `idx_${schema.name}_${field.name}` })
    }

    const dbPolicies = dbPolicyRows.filter((p) => p.entity === target).map((p) => p.id)
    const baselineOrphans = baselinePolicies
        .filter((p) => p.entity === target)
        .map((p) => ({ source: p.source ?? "app", roles: p.roles ?? null }))

    // roles that lose a grant (informational — roles themselves survive)
    const rolesAffected = [...new Set(
        [...dbPolicyRows, ...baselinePolicies]
            .filter((p) => p.entity === target)
            .flatMap((p) => (Array.isArray(p.roles) ? p.roles : typeof p.roles === "string" && p.roles ? JSON.parse(p.roles) : []))
    )].sort()

    return {
        entity: target,
        rowCount,
        schemaFile: own.file,
        dbPolicies,
        baselineOrphans,
        linkDrops,
        views: viewRows.filter((v) => v.entity === target).map((v) => v.id),
        rolesAffected
    }
}

/**
 * Perform a cascade plan. Exactly what it named, in an order chosen so that a
 * failure anywhere leaves the instance as it was.
 *
 *   compute every new file body (in memory)
 *     → ONE transaction: policies → views → DROP COLUMNs → embeddings → DROP TABLE
 *       → commit
 *         → write the files, then remove the target's schema file
 *           → if a file write fails, restore what was written, then throw
 *
 * Three properties that were missing and are the point of this function:
 *
 *  1. **One transaction.** Row deletes and DDL commit together or not at all.
 *     A cascade that stopped half way used to leave the policies and views
 *     deleted and the table still there.
 *  2. **No swallowed errors.** A `DROP COLUMN` that fails aborts the cascade
 *     instead of being caught and ignored. The one legitimate tolerance — an
 *     instance that never embedded anything has no `_nexus_embeddings` table —
 *     is an existence question with an answer, so it is ASKED. A catch-all
 *     there would equally hide a real failure.
 *  3. **The database leads, the files follow.** The old order rewrote a
 *     schema file to drop a link field BEFORE the `DROP COLUMN` that might
 *     silently fail; when it did, the file said the field was gone and the
 *     table said it was not, a permanent divergence nothing reconciles.
 *
 * Refuses outright on an engine whose DDL cannot roll back (MySQL commits it
 * implicitly, C5). That is the opposite of `hotApply`'s choice on the same
 * engines, deliberately: this operation is DESTRUCTIVE, so a half-done one
 * loses data and refusing costs the operator another route and nothing else.
 *
 * @param {Object} args
 * @param {{run, all, transaction?}} args.executor
 * @param {string} args.root - instance directory
 * @param {Object} args.plan - the output of entityDeletePlan
 * @param {string} [args.dialect="sqlite"]
 * @returns {Promise<{deleted: string, plan: Object}>}
 */
export async function applyEntityDelete({ executor, root, plan, dialect = "sqlite" }) {
    if (!capabilitiesFor(dialect).transactionalDDL)
        throw err(
            "E_NO_TRANSACTIONAL_DDL",
            `dialect "${dialect}" commits DDL implicitly — a cascade delete cannot be rolled back on it. Take a backup and remove the entity with the engine's own tooling.`
        )

    // Every identifier below comes from a validated schema (entityDeletePlan
    // refuses unknown and system entities before anything gets here), and is
    // quoted regardless — the guarantee should not rest on one function's
    // memory of what another already checked.
    const quote = (name) => `"${String(name).replace(/"/g, '""')}"`

    // 1) New file bodies, in memory, BEFORE anything is touched.
    const rewrites = plan.linkDrops.map((drop) => {
        const path = join(root, drop.file)
        const original = readFileSync(path, "utf8")
        const doc = JSON.parse(original)
        doc.fields = doc.fields.filter((f) => f.name !== drop.field)
        return { path, original, next: JSON.stringify(doc, null, 4) }
    })

    // An existence question, asked rather than caught (see property 2 above).
    const hasEmbeddings = (
        await executor.all(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = '_nexus_embeddings'`, [])
    ).length > 0

    // 2) All database work, atomically.
    await transactionOf(executor)(async (tx) => {
        for (const id of plan.dbPolicies) await tx.run(`DELETE FROM ${quote("nexus_policy")} WHERE id = ?`, [id])
        for (const id of plan.views) await tx.run(`DELETE FROM ${quote("nexus_view")} WHERE id = ?`, [id])
        for (const drop of plan.linkDrops) {
            // The index first: sqlite refuses to drop a column an index still
            // references, so the column drop cannot succeed without this. The
            // old code's swallowed catch meant this failed on every cascade
            // that had a link pointing at the target, leaving the column in
            // place while its schema file said otherwise.
            if (drop.index) await tx.run(`DROP INDEX IF EXISTS ${quote(drop.index)}`, [])
            await tx.run(`ALTER TABLE ${quote(drop.entity)} DROP COLUMN ${quote(drop.field)}`, [])
        }
        if (hasEmbeddings) await tx.run(`DELETE FROM ${quote("_nexus_embeddings")} WHERE entity = ?`, [plan.entity])
        await tx.run(`DROP TABLE IF EXISTS ${quote(plan.entity)}`, [])
    })

    // 3) Files follow the committed database. If one write fails, put back
    // what this call wrote — the DB is the authority and the files are
    // reconciled to it, never the other way round.
    const written = []
    try {
        for (const rewrite of rewrites) {
            writeFileSync(rewrite.path, rewrite.next)
            written.push(rewrite)
        }
        rmSync(join(root, plan.schemaFile))
    } catch (error) {
        for (const rewrite of written) {
            try { writeFileSync(rewrite.path, rewrite.original) } catch {}
        }
        throw err("E_SCHEMA_FILES", `the database change committed but its schema files did not: ${error.message}`)
    }

    return { deleted: plan.entity, plan }
}

export default { entityDeletePlan, applyEntityDelete }
