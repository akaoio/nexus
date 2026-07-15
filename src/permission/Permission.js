/**
 * Permission v1 — the Permission Engine of Nexus (ARCHITECTURE.md §4.3).
 *
 * Deny by default is the constitution: no applicable policy, no access —
 * everything else is carve-outs. Policies are additive (Directus v11): the
 * rules of all applicable permlevel-0 policies union with OR, ifOwner ANDs
 * an owner restriction into its own policy's rule before that union, and
 * document shares OR one id-set on top. The resulting filter is a fully
 * resolved, valid Query AST v1 document — handed to AST.inject() so that no
 * query ever escapes it. This module implements the v1 contract as defined
 * by test/conformance/permission/ (clauses PERM-A/R/F/SH) — the test suite
 * is the spec; this file merely earns it.
 *
 * Field access follows Frappe's permlevel model faithfully: a policy grants
 * fields at its own level only, and no permlevel-0 policy means no document
 * access — and therefore no fields at all.
 */

import { validate as validateAst, resolve as resolveAst, AST_VERSION } from "../ast/AST.js"
import { SYSTEM_FIELDS } from "../model/Model.js"

/** The closed v1 action set — Frappe's document lifecycle. */
export const ACTIONS = Object.freeze(["read", "write", "create", "delete", "submit", "cancel", "amend"])

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

// ─── shared input validation — loud rejection, never silent skips ────────────

function checkAction(action) {
    if (!ACTIONS.includes(action)) throw err("E_UNKNOWN_ACTION", `"${action}"`)
}

function checkPolicies(policies) {
    for (const policy of policies) {
        for (const action of policy.actions ?? []) checkAction(action)
        const permlevel = policy.permlevel ?? 0
        if (!Number.isInteger(permlevel) || permlevel < 0 || permlevel > 9)
            throw err("E_PERMLEVEL", `permlevel ${permlevel}`)
        if (policy.rule != null) {
            const result = validateAst(policy.rule)
            if (!result.valid) throw err("E_INVALID", JSON.stringify(result.errors))
        }
    }
}

const applicable = (policy, ctx) =>
    policy.entity === ctx.entity && (policy.actions ?? []).includes(ctx.action)

// ─── resolve — the document-level access decision ─────────────────────────────

/**
 * Decide document access for a request and produce the row-level filter.
 * @param {Array} policies - Policies already assigned to the requesting user
 * @param {Object} ctx - { entity, action, user, roles[, now] }
 * @param {Array} [shares] - Ad-hoc document shares [{ id, user, actions }]
 * @returns {{allowed: boolean, filter: Object|null}} filter is a fully
 *   resolved, valid AST v1 document — null means unrestricted
 */
export function resolve(policies, ctx, shares = []) {
    checkAction(ctx.action)
    checkPolicies(policies)
    for (const share of shares) for (const action of share.actions ?? []) checkAction(action)

    const astContext = { user: ctx.user, roles: ctx.roles, now: ctx.now }
    const granted = policies.filter((p) => applicable(p, ctx) && (p.permlevel ?? 0) === 0)

    const sharedIds = shares
        .filter((s) => s.user === ctx.user && (s.actions ?? []).includes(ctx.action))
        .map((s) => s.id)

    if (!granted.length && !sharedIds.length) return { allowed: false, filter: null }

    // Union the policy rules (OR). Any unrestricted policy short-circuits to
    // match-all — a wider filter than any union could produce.
    const roots = []
    let unrestricted = false
    for (const policy of granted) {
        const ruleRoot = policy.rule != null ? resolveAst(policy.rule, astContext).root : null
        const ownerLeaf = policy.ifOwner === true
            ? { field: "owner", operator: "eq", value: ctx.user }
            : null
        if (ruleRoot === null && ownerLeaf === null) {
            unrestricted = true
            break
        }
        if (ruleRoot !== null && ownerLeaf !== null)
            roots.push({ op: "and", children: [ruleRoot, ownerLeaf] })
        else roots.push(ruleRoot ?? ownerLeaf)
    }
    if (unrestricted) return { allowed: true, filter: null }

    if (sharedIds.length) roots.push({ field: "id", operator: "in", value: sharedIds })

    const root = roots.length === 1 ? roots[0] : { op: "or", children: roots }
    return { allowed: true, filter: { astVersion: AST_VERSION, root } }
}

// ─── fields — permlevel field access (Frappe-faithful) ────────────────────────

/**
 * List the field names accessible for a request. A policy grants fields at
 * its own permlevel only; without any permlevel-0 policy for the action
 * there is no document access and therefore no fields. System fields ride
 * at permlevel 0.
 * @param {Array} policies - Policies already assigned to the requesting user
 * @param {Object} ctx - { entity, action, user, roles }
 * @param {Object} schema - The entity's Model Schema v1 document
 * @returns {string[]} Sorted, duplicate-free field names
 */
export function fields(policies, ctx, schema) {
    checkAction(ctx.action)
    checkPolicies(policies)

    const levels = new Set(
        policies.filter((p) => applicable(p, ctx)).map((p) => p.permlevel ?? 0)
    )
    if (!levels.has(0)) return []

    const names = new Set(SYSTEM_FIELDS)
    for (const field of schema.fields ?? [])
        if (levels.has(field.permlevel ?? 0)) names.add(field.name)

    return [...names].sort()
}

export default { ACTIONS, resolve, fields }
