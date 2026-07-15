/**
 * Shared helpers for Permission conformance suites. Test infrastructure,
 * not spec.
 *
 * Policy document shape (defined by the PERM clauses):
 *   { entity, actions: [...], rule: <AST doc>|null, permlevel: 0, ifOwner: false }
 *
 * Policy ASSIGNMENT (which roles/users carry which policies) resolves
 * upstream; resolve() receives the list of policies already applicable to
 * the requesting user. rule uses AST v1 documents and may contain dynamic
 * variables ($CURRENT_USER…) — resolve() returns them fully resolved.
 */

import { doc, leaf } from "../ast/_helpers.js"

/** A policy with sane defaults; override what the clause needs. */
export const policy = (over = {}) => ({
    entity: "customer",
    actions: ["read"],
    rule: null,
    permlevel: 0,
    ifOwner: false,
    ...over
})

/** A request context with sane defaults. */
export const ctx = (over = {}) => ({
    entity: "customer",
    action: "read",
    user: "u1",
    roles: ["sales"],
    ...over
})

/** Shorthand: a rule document from a single leaf. */
export const rule = (field, operator, value) => doc(leaf(field, operator, value))

/** Fixture rows shared with the AST suites (id/tier/owner/age/active/name/score). */
export { ROWS, filter, doc, leaf, and, or } from "../ast/_helpers.js"
