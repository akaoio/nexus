/**
 * Query AST v1 — the universal query structure of Nexus (ARCHITECTURE.md §4.2).
 *
 * One recursive JSON structure drives queries, permission rules, validations
 * and the visual query builder. This module implements the v1 contract as
 * defined by test/conformance/ast/ (clauses AST-S/O/V/P/I/N/Q) — the test
 * suite is the spec; this file merely earns it.
 *
 * Document envelope: { astVersion: 1, root: <node|null> } — root null means
 * match-all. A node is EITHER a logic node { op: and|or|not, children: [...] }
 * OR a leaf { field, operator[, value] } — never both. Logic nesting depth is
 * unlimited. The operator set is closed and frozen; evolution happens in a
 * new astVersion, never by mutating v1 semantics (principle N4).
 *
 * Compile targets: predicate() is the JS reference target — the SQL targets
 * (Phase 2, via Kysely) must agree with it row-for-row.
 */

export const AST_VERSION = 1

/** The closed v1 operator set. Adding an operator requires a new astVersion. */
export const OPERATORS = Object.freeze([
    "eq", "ne", "gt", "gte", "lt", "lte",
    "in", "nin", "like", "nlike",
    "isnull", "notnull", "between"
])

const LOGIC_OPS = ["and", "or", "not"]
const SEGMENT_RE = /^[a-z][a-z0-9_]*$/
const VARIABLE_RE = /^\$([A-Z_]+)(?:\((.*)\))?$/
const OFFSET_RE = /^([+-])(\d+)([smhd])$/
const OFFSET_MS = { s: 1000, m: 60000, h: 3600000, d: 86400000 }
const DEFAULT_MAX_DEPTH = 3

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)
const clone = (x) => (x === undefined ? undefined : JSON.parse(JSON.stringify(x)))
const isScalar = (x) => ["string", "number", "boolean"].includes(typeof x)
const isVariable = (x) => typeof x === "string" && VARIABLE_RE.test(x)
const isNullish = (x) => x === null || x === undefined

// ─── validate ─────────────────────────────────────────────────────────────────

/**
 * Validate a v1 document. Never throws.
 * @param {*} doc - Candidate document
 * @param {Object} [opts] - { maxDepth } relation-hop limit (default 3)
 * @returns {{valid: true} | {valid: false, errors: Array<{code: string, path: string}>}}
 */
export function validate(doc, opts = {}) {
    const maxDepth = opts.maxDepth ?? DEFAULT_MAX_DEPTH
    if (doc === null || typeof doc !== "object" || Array.isArray(doc))
        return { valid: false, errors: [{ code: "E_DOC", path: "" }] }

    const errors = []
    if (!("astVersion" in doc)) errors.push({ code: "E_VERSION", path: "/astVersion" })
    else if (doc.astVersion !== AST_VERSION) errors.push({ code: "E_VERSION_UNKNOWN", path: "/astVersion" })
    for (const key of Object.keys(doc))
        if (key !== "astVersion" && key !== "root") errors.push({ code: "E_DOC_KEYS", path: `/${key}` })
    if (!("root" in doc)) errors.push({ code: "E_ROOT", path: "/root" })
    if (errors.length) return { valid: false, errors }

    if (doc.root !== null) validateNode(doc.root, "/root", errors, maxDepth)
    return errors.length ? { valid: false, errors } : { valid: true }
}

function validateNode(node, path, errors, maxDepth) {
    if (node === null || typeof node !== "object" || Array.isArray(node))
        return errors.push({ code: "E_NODE_SHAPE", path })
    const hasOp = "op" in node
    const hasField = "field" in node
    if (hasOp && hasField) return errors.push({ code: "E_HYBRID_NODE", path })
    if (!hasOp && !hasField) return errors.push({ code: "E_NODE_SHAPE", path })
    if (hasOp) return validateLogic(node, path, errors, maxDepth)
    return validateLeaf(node, path, errors, maxDepth)
}

function validateLogic(node, path, errors, maxDepth) {
    for (const key of Object.keys(node))
        if (key !== "op" && key !== "children") return errors.push({ code: "E_NODE_KEYS", path })
    if (!LOGIC_OPS.includes(node.op)) return errors.push({ code: "E_UNKNOWN_LOGIC", path })
    if (!Array.isArray(node.children))
        return errors.push({ code: node.op === "not" ? "E_NOT_ARITY" : "E_EMPTY_CHILDREN", path })
    if (node.op === "not" && node.children.length !== 1) return errors.push({ code: "E_NOT_ARITY", path })
    if (node.op !== "not" && node.children.length === 0) return errors.push({ code: "E_EMPTY_CHILDREN", path })
    node.children.forEach((child, i) => validateNode(child, `${path}/children/${i}`, errors, maxDepth))
}

function validateLeaf(node, path, errors, maxDepth) {
    for (const key of Object.keys(node))
        if (key !== "field" && key !== "operator" && key !== "value")
            return errors.push({ code: "E_NODE_KEYS", path })

    const segments = typeof node.field === "string" ? node.field.split(".") : null
    if (!segments || !segments.every((s) => SEGMENT_RE.test(s)))
        return errors.push({ code: "E_FIELD_NAME", path })
    if (segments.length - 1 > maxDepth) return errors.push({ code: "E_PATH_DEPTH", path })

    if (typeof node.operator !== "string" || !OPERATORS.includes(node.operator))
        return errors.push({ code: "E_UNKNOWN_OPERATOR", path })

    const op = node.operator
    if (op === "isnull" || op === "notnull") {
        if ("value" in node) errors.push({ code: "E_VALUE_FORBIDDEN", path })
        return
    }
    if (!("value" in node)) return errors.push({ code: "E_VALUE_TYPE", path })

    const value = node.value
    // Stored documents may legitimately contain unresolved variables
    // (e.g. permission rules with $CURRENT_USER) — they are valid documents.
    if (isVariable(value)) return

    if (op === "in" || op === "nin") return validateArrayValue(value, path, errors, null)
    if (op === "between") return validateArrayValue(value, path, errors, 2)

    if (value === null) return errors.push({ code: "E_NULL_VALUE", path })
    if (!isScalar(value)) return errors.push({ code: "E_VALUE_TYPE", path })
    if ((op === "like" || op === "nlike") && typeof value !== "string")
        return errors.push({ code: "E_VALUE_TYPE", path })
}

function validateArrayValue(value, path, errors, exactLength) {
    if (!Array.isArray(value)) return errors.push({ code: "E_VALUE_TYPE", path })
    if (exactLength !== null && value.length !== exactLength)
        return errors.push({ code: "E_VALUE_TYPE", path })
    if (exactLength === null && value.length === 0) return errors.push({ code: "E_VALUE_EMPTY", path })
    for (const el of value) {
        if (isVariable(el)) continue
        if (el === null) return errors.push({ code: "E_NULL_VALUE", path })
        if (!isScalar(el)) return errors.push({ code: "E_VALUE_TYPE", path })
    }
}

// ─── resolve — dynamic variables become literals before any compile ──────────

/**
 * Resolve dynamic variables ($CURRENT_USER, $CURRENT_ROLES, $NOW[(±n unit)])
 * against a context with an injected clock. Pure and idempotent.
 * @param {Object} doc - v1 document (may contain variables)
 * @param {Object} context - { user, roles, now } (now: ISO-8601 string)
 * @returns {Object} A new, fully-resolved document
 */
export function resolve(doc, context = {}) {
    const out = clone(doc)
    if (out && typeof out === "object" && out.root) resolveNode(out.root, context)
    return out
}

function resolveNode(node, context) {
    if (node === null || typeof node !== "object") return
    if (Array.isArray(node.children)) {
        for (const child of node.children) resolveNode(child, context)
        return
    }
    if (!("value" in node)) return
    if (isVariable(node.value)) node.value = resolveVariable(node.value, context)
    else if (Array.isArray(node.value))
        node.value = node.value.map((el) => (isVariable(el) ? resolveVariable(el, context) : el))
}

function resolveVariable(expr, context) {
    const [, name, arg] = expr.match(VARIABLE_RE)
    switch (name) {
        case "CURRENT_USER":
            if (isNullish(context.user)) throw err("E_MISSING_CONTEXT", "context.user is required for $CURRENT_USER")
            return context.user
        case "CURRENT_ROLES":
            if (isNullish(context.roles)) throw err("E_MISSING_CONTEXT", "context.roles is required for $CURRENT_ROLES")
            return clone(context.roles)
        case "NOW": {
            if (isNullish(context.now)) throw err("E_MISSING_CONTEXT", "context.now is required for $NOW")
            if (arg === undefined) return context.now
            const match = arg.match(OFFSET_RE)
            if (!match) throw err("E_UNKNOWN_VAR", `bad $NOW offset "${arg}"`)
            const [, sign, amount, unit] = match
            const shift = Number(amount) * OFFSET_MS[unit] * (sign === "-" ? -1 : 1)
            return new Date(new Date(context.now).getTime() + shift).toISOString()
        }
        default:
            throw err("E_UNKNOWN_VAR", expr)
    }
}

/** True if the document still contains any unresolved variable. */
function hasUnresolved(node) {
    if (node === null || typeof node !== "object") return false
    if (Array.isArray(node.children)) return node.children.some((c) => hasUnresolved(c))
    if (!("value" in node)) return false
    if (isVariable(node.value)) return true
    return Array.isArray(node.value) && node.value.some((el) => isVariable(el))
}

// ─── predicate — the JS reference compile target ──────────────────────────────

/**
 * Compile a resolved, valid v1 document into a total predicate over plain
 * rows. Relation paths traverse nested objects; an array met along a path
 * uses ANY-match (child-table EXISTS semantics). Null/missing field values
 * follow SQL WHERE semantics: every comparison is false, only isnull matches.
 * @param {Object} doc - Resolved, valid v1 document
 * @returns {(row: *) => boolean}
 */
export function predicate(doc) {
    if (doc && typeof doc === "object" && hasUnresolved(doc.root ?? null))
        throw err("E_UNRESOLVED", "document contains unresolved variables — call resolve() first")
    const result = validate(doc)
    if (!result.valid) throw err("E_INVALID", JSON.stringify(result.errors))
    if (doc.root === null) return () => true
    const compiled = compileNode(doc.root)
    return (row) => !!compiled(row)
}

function compileNode(node) {
    if ("op" in node) {
        const children = node.children.map(compileNode)
        if (node.op === "and") return (row) => children.every((c) => c(row))
        if (node.op === "or") return (row) => children.some((c) => c(row))
        return (row) => !children[0](row) // not
    }
    const segments = node.field.split(".")
    const test = compileOperator(node.operator, node.value)
    return (row) => {
        const values = []
        collect(row, segments, 0, values)
        return values.some(test)
    }
}

/** Walk a path through a row; arrays flatten to ANY semantics at any point. */
function collect(obj, segments, i, out) {
    if (Array.isArray(obj)) {
        for (const el of obj) collect(el, segments, i, out)
        return
    }
    if (i === segments.length) return out.push(obj)
    if (obj === null || typeof obj !== "object") return out.push(undefined)
    collect(obj[segments[i]], segments, i + 1, out)
}

function compileOperator(op, sv) {
    if (op === "isnull") return (fv) => isNullish(fv)
    if (op === "notnull") return (fv) => !isNullish(fv)

    const ordered = (rel) => (fv) =>
        typeof fv === typeof sv && (typeof fv === "number" || typeof fv === "string") && rel(fv, sv)

    let inner
    switch (op) {
        case "eq": inner = (fv) => fv === sv; break
        case "ne": inner = (fv) => fv !== sv; break
        case "gt": inner = ordered((a, b) => a > b); break
        case "gte": inner = ordered((a, b) => a >= b); break
        case "lt": inner = ordered((a, b) => a < b); break
        case "lte": inner = ordered((a, b) => a <= b); break
        case "in": inner = (fv) => sv.includes(fv); break
        case "nin": inner = (fv) => !sv.includes(fv); break
        case "like": {
            const re = likeToRegExp(sv)
            inner = (fv) => typeof fv === "string" && re.test(fv)
            break
        }
        case "nlike": {
            const re = likeToRegExp(sv)
            inner = (fv) => typeof fv === "string" && !re.test(fv)
            break
        }
        case "between": {
            const [min, max] = sv
            inner = (fv) =>
                typeof fv === typeof min &&
                typeof min === typeof max &&
                (typeof fv === "number" || typeof fv === "string") &&
                fv >= min &&
                fv <= max
            break
        }
    }
    // SQL WHERE null semantics: comparisons on null/missing are false — always.
    return (fv) => (isNullish(fv) ? false : inner(fv))
}

const REGEX_META = /[.*+?^${}()|[\]\\]/g
const escapeRegExp = (s) => s.replace(REGEX_META, "\\$&")

/** LIKE → RegExp: % any run, _ one char, backslash escapes; anchored, ASCII case-insensitive. */
function likeToRegExp(pattern) {
    let out = ""
    for (let i = 0; i < pattern.length; i++) {
        const ch = pattern[i]
        if (ch === "\\" && i + 1 < pattern.length) out += escapeRegExp(pattern[++i])
        else if (ch === "%") out += "[\\s\\S]*"
        else if (ch === "_") out += "[\\s\\S]"
        else out += escapeRegExp(ch)
    }
    return new RegExp(`^${out}$`, "i")
}

// ─── inject — permission composition (row-level security) ────────────────────

/**
 * AND-combine a query document with a permission document. A row passes only
 * if it passes both — injection can only ever NARROW the result set. A null
 * root on either side means "no restriction" at this layer (deny-by-default
 * lives in the Permission Engine above).
 * @param {Object} query - v1 document (root may be null)
 * @param {Object} permission - v1 document (root may be null)
 * @returns {Object} A new valid v1 document
 */
export function inject(query, permission) {
    const q = query?.root ?? null
    const p = permission?.root ?? null
    let root
    if (q === null && p === null) root = null
    else if (q === null) root = clone(p)
    else if (p === null) root = clone(q)
    else root = { op: "and", children: [clone(q), clone(p)] }
    return { astVersion: AST_VERSION, root }
}

// ─── upgrade — the only path between versions (N4) ────────────────────────────

/**
 * Upgrade a document of any known astVersion to the current one.
 * v1 is the only version today, so this is the identity on v1.
 * @param {Object} doc - Document with a known astVersion
 * @returns {Object} An equivalent current-version document
 */
export function upgrade(doc) {
    if (doc?.astVersion === AST_VERSION) return clone(doc)
    throw err("E_VERSION_UNKNOWN", `cannot upgrade astVersion ${doc?.astVersion}`)
}

export default { AST_VERSION, OPERATORS, validate, resolve, predicate, inject, upgrade }
