/**
 * Entity lifecycle — the DELETE side. Removing an entity must leave the
 * instance CLEAN: its table and rows, its schema file, the policies that
 * point at it, its saved views, and every link column other entities aim
 * at it. The PLAN is computed here, pure and complete, so the Studio can
 * show a dry run and the human confirms by typing the entity's name —
 * destruction is informed, never incidental. The executor (dev server)
 * merely performs the plan.
 */

import { isSystem } from "./system.js"

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

    // link columns in OTHER entities aiming at the target — they DROP
    const linkDrops = []
    for (const { schema, file } of schemas) {
        if (schema.name === target) continue
        for (const field of schema.fields ?? [])
            if (field.type === "link" && field.target === target)
                linkDrops.push({ entity: schema.name, field: field.name, file })
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

export default { entityDeletePlan }
