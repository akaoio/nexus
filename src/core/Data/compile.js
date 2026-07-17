/**
 * Query AST → Kysely compiler — the SQL target of the universal Query AST
 * (ARCHITECTURE.md §4.2, target #1). The JS predicate (src/core/AST.js) is
 * the REFERENCE semantics; this compiler's one job is to make real engines
 * agree with it row-for-row — the golden invariant, pinned by CMP-* clauses
 * against a real SQLite engine and by the seeded AST-Q generators.
 *
 * The core correctness decision: every leaf compiles to a TWO-VALUED
 * expression. Naive SQL is three-valued — `NOT (tier = 'gold')` on a NULL
 * tier yields UNKNOWN and drops the row, while the reference predicate
 * evaluates eq→false, not→true and keeps it (AST-P04). Wrapping each leaf
 * as `(expr AND col IS NOT NULL)` (isnull/notnull are already two-valued)
 * makes every leaf TRUE or FALSE, never NULL — so and/or/not become plain
 * boolean algebra and equivalence with the predicate holds structurally.
 * Generated SQL is verbose; equivalence outranks beauty.
 *
 * Dialect notes (why options.dialect exists):
 *  - like/nlike are case-insensitive ASCII by spec (AST-O12). SQLite and
 *    MySQL defaults match; Postgres LIKE is case-sensitive → compiled as
 *    ILIKE there.
 *  - The spec's backslash escapes (AST-O13): SQLite has NO default LIKE
 *    escape character → compiled with an explicit ESCAPE '\'. Postgres and
 *    MySQL default to backslash already. Turso shares the sqlite dialect.
 *
 * Scope: single-column fields. Relation paths (a.b) need the relation
 * layer's schema context to become EXISTS subqueries — without a schema
 * context they are rejected loudly with E_PATH, never mistranslated.
 *
 * Values are ALWAYS emitted as bindings — never inlined into SQL. Field
 * names are safe by construction (validated /^[a-z][a-z0-9_]*$/) and
 * quoted by Kysely regardless.
 */

import { validate } from "../AST.js"
import { sql, DIALECT_NAMES } from "./kysely.js"

// Mirrors the AST module's internal variable pattern: a stored document may
// carry $VARIABLES, but it must go through AST.resolve() before compiling.
const VARIABLE_RE = /^\$[A-Z_]+(\(.*\))?$/

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)
const isVariable = (x) => typeof x === "string" && VARIABLE_RE.test(x)

function hasUnresolved(node) {
    if (node === null || typeof node !== "object") return false
    if (Array.isArray(node.children)) return node.children.some((c) => hasUnresolved(c))
    if (!("value" in node)) return false
    if (isVariable(node.value)) return true
    return Array.isArray(node.value) && node.value.some((el) => isVariable(el))
}

/**
 * Compile a resolved, valid v1 document into a Kysely where-callback:
 *   qb.where(toWhere(doc, { dialect }))
 * The root must be a node — a null root means match-all and has no WHERE
 * expression; use applyWhere() to handle both cases.
 * @param {Object} doc - Resolved, valid AST v1 document with non-null root
 * @param {Object} [options] - { dialect: "sqlite"|"turso"|"postgres"|"mysql" }
 * @returns {(eb: import("../../../vendor/kysely/index.js").ExpressionBuilder) => *}
 */
export function toWhere(doc, options = {}) {
    const dialect = options.dialect ?? "sqlite"
    if (!DIALECT_NAMES.includes(dialect)) throw err("E_DIALECT", `unknown dialect "${dialect}"`)
    if (doc && typeof doc === "object" && hasUnresolved(doc.root ?? null))
        throw err("E_UNRESOLVED", "document contains unresolved variables — call AST.resolve() first")
    const result = validate(doc)
    if (!result.valid) throw err("E_INVALID", JSON.stringify(result.errors))
    if (doc.root === null) throw err("E_EMPTY", "root null is match-all — use applyWhere()")
    return (eb) => compileNode(eb, doc.root, dialect)
}

/**
 * Apply a document to a Kysely query builder: match-all (root null) returns
 * the builder untouched; anything else adds the compiled WHERE.
 * @param {*} qb - A Kysely select/update/delete builder
 * @param {Object} doc - Resolved, valid AST v1 document
 * @param {Object} [options] - { dialect }
 * @returns {*} The (possibly filtered) builder
 */
export function applyWhere(qb, doc, options = {}) {
    const result = validate(doc)
    if (!result.valid) throw err("E_INVALID", JSON.stringify(result.errors))
    if (doc.root === null) return qb
    return qb.where(toWhere(doc, options))
}

// ─── node compilation — two-valued boolean algebra ───────────────────────────

function compileNode(eb, node, dialect) {
    if ("op" in node) {
        const children = node.children.map((child) => compileNode(eb, child, dialect))
        if (node.op === "and") return eb.and(children)
        if (node.op === "or") return eb.or(children)
        return eb.not(children[0]) // not — exact inversion, leaves are two-valued
    }
    return compileLeaf(eb, node, dialect)
}

function compileLeaf(eb, { field, operator, value }, dialect) {
    if (field.includes("."))
        throw err("E_PATH", `relation path "${field}" needs a schema context (relation layer) — refusing to mistranslate`)

    const notNull = eb(field, "is not", null)
    const twoValued = (expr) => eb.and([expr, notNull])

    switch (operator) {
        case "isnull": return eb(field, "is", null)
        case "notnull": return notNull
        case "eq": return twoValued(eb(field, "=", value))
        case "ne": return twoValued(eb(field, "!=", value))
        case "gt": return twoValued(eb(field, ">", value))
        case "gte": return twoValued(eb(field, ">=", value))
        case "lt": return twoValued(eb(field, "<", value))
        case "lte": return twoValued(eb(field, "<=", value))
        case "in": return twoValued(eb(field, "in", value))
        case "nin": return twoValued(eb(field, "not in", value))
        case "between":
            // >= AND <= — inclusive by spec (AST-O19), no dialect BETWEEN quirks
            return eb.and([eb(field, ">=", value[0]), eb(field, "<=", value[1]), notNull])
        case "like": return twoValued(likeBase(eb, field, value, dialect))
        case "nlike": return twoValued(eb.not(likeBase(eb, field, value, dialect)))
        default:
            // Unreachable: validate() enforces the closed operator set
            throw err("E_UNKNOWN_OPERATOR", operator)
    }
}

function likeBase(eb, field, value, dialect) {
    if (dialect === "postgres") return eb(field, "ilike", value)
    if (dialect === "mysql") return eb(field, "like", value)
    // sqlite/turso: explicit ESCAPE (no default escape char in SQLite);
    // case-insensitive ASCII natively — matches the spec exactly
    return sql`${sql.ref(field)} like ${value} escape '\\'`
}

export default { toWhere, applyWhere }
