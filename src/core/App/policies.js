/**
 * Policies — the canonical policy validator (shared by the Studio manager
 * and the loaders) plus the app-side policy loading and role assignment of
 * docs/authn-design.md §2.
 *
 * apps/<app>/permissions/*.json each hold an ARRAY of Permission v1 policy
 * objects (entity, actions, rule, permlevel, ifOwner) with the optional
 * `roles` assignment annotation: with roles = role-gated; without roles =
 * applies to every AUTHENTICATED user (the app's baseline). The engine's
 * deny-by-default covers everything else.
 */

import { ACTIONS } from "../Permission.js"
import * as AST from "../AST.js"

// This module is imported by the Studio permission-manager (browser) for the
// pure validators, so it must stay browser-loadable — no top-level fs/path
// import. loadPolicies (Node-only) reaches the built-ins synchronously via
// process.getBuiltinModule (Node ≥22), which simply does not exist in a
// browser and is never called there.
const _fs = () => process.getBuiltinModule("fs")
const _path = () => process.getBuiltinModule("path")

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

/**
 * Non-throwing policy validation. When `schemas` is provided the entity
 * must be one of them.
 * @returns {{valid: true} | {valid: false, errors: Array<{code: string}>}}
 */
export function validatePolicy(policy, schemas = null) {
    const errors = []
    if (policy === null || typeof policy !== "object" || Array.isArray(policy))
        return { valid: false, errors: [{ code: "E_POLICY" }] }

    if (typeof policy.entity !== "string" || !policy.entity) errors.push({ code: "E_ENTITY" })
    else if (schemas && !schemas.some((s) => s.name === policy.entity)) errors.push({ code: "E_ENTITY" })

    if (!Array.isArray(policy.actions) || policy.actions.length === 0) errors.push({ code: "E_ACTIONS" })
    else if (!policy.actions.every((a) => ACTIONS.includes(a))) errors.push({ code: "E_ACTIONS" })

    const permlevel = policy.permlevel ?? 0
    if (!Number.isInteger(permlevel) || permlevel < 0 || permlevel > 9) errors.push({ code: "E_PERMLEVEL" })

    if (policy.rule !== null && policy.rule !== undefined && !AST.validate(policy.rule).valid)
        errors.push({ code: "E_RULE" })

    if (policy.ifOwner !== undefined && typeof policy.ifOwner !== "boolean") errors.push({ code: "E_IFOWNER" })

    if (policy.roles !== undefined && (!Array.isArray(policy.roles) || !policy.roles.every((r) => typeof r === "string")))
        errors.push({ code: "E_ROLES" })

    return errors.length ? { valid: false, errors } : { valid: true }
}

/** The whole set at once. */
export const validatePolicies = (policies, schemas = null) =>
    Array.isArray(policies) && policies.every((p) => validatePolicy(p, schemas).valid)

/** Load and validate every app's permissions/*.json — loudly. Node-only. */
export function loadPolicies(root, apps, schemas) {
    const { readFileSync, readdirSync, existsSync } = _fs()
    const { join } = _path()
    const policies = []
    for (const app of apps ?? []) {
        const dir = join(root, "apps", app.dir, "permissions")
        if (!existsSync(dir)) continue
        for (const entry of readdirSync(dir)) {
            if (!entry.endsWith(".json")) continue
            const file = `apps/${app.dir}/permissions/${entry}`
            const list = JSON.parse(readFileSync(join(root, file), "utf8"))
            if (!Array.isArray(list)) throw err("E_POLICIES", `${file} must hold an array of policies`)
            for (const policy of list) {
                const result = validatePolicy(policy, schemas)
                if (!result.valid) throw err("E_INVALID", `${file}: ${JSON.stringify(result.errors)}`)
                policies.push(policy)
            }
        }
    }
    return policies
}

/** docs/authn-design.md §2 — assignment: role-gated or authenticated-baseline. */
export function policiesFor(policies, roles = []) {
    return policies.filter((p) => !p.roles || p.roles.some((r) => roles.includes(r)))
}

/**
 * A ROLE is a name that bundles policies: every policy carrying the name
 * grants through it, every identity holding the name receives the bundle.
 * This aggregates that picture — the roles overview the Studio renders.
 * Pure; roles appear whether they come from policies, identities, or both.
 * @param {Array} policies - Permission v1 policies (optional roles annotation)
 * @param {Array} [identities] - [{ pub, name, roles }] from nexus.config.json
 * @returns {Array<{role: string, policies: number, users: number}>} sorted by name
 */
export function rolesIn(policies = [], identities = []) {
    const map = new Map()
    const entry = (role) => {
        if (!map.has(role)) map.set(role, { role, policies: 0, users: 0 })
        return map.get(role)
    }
    for (const p of policies) for (const role of p.roles ?? []) entry(role).policies++
    for (const u of identities) for (const role of u.roles ?? []) entry(role).users++
    return [...map.values()].sort((a, b) => (a.role < b.role ? -1 : 1))
}

export default { validatePolicy, validatePolicies, loadPolicies, policiesFor, rolesIn }
