/**
 * Model Schema v1 — the Entity meta-model of Nexus (ARCHITECTURE.md §4.1).
 *
 * An Entity is data, not code: a versioned document from which tables, forms,
 * APIs and migrations derive. This module implements the v1 contract as
 * defined by test/conformance/model/ (clauses MS-S/T/D/C/N) — the test suite
 * is the spec; this file merely earns it.
 *
 * Envelope: { schemaVersion: 1, name, fields: [...] } plus optional label,
 * indexes, semantic, permissions. The format is frozen (N4): unknown keys are
 * errors; evolution happens in a new schemaVersion. Every entity implicitly
 * carries the system fields id, owner, created_at, updated_at.
 *
 * diff() classifies changes additive (safe for hot DDL) vs structural
 * (reviewed migration required) — the Migration Engine's safety boundary.
 * merge() applies site customizations (custom fields + property overrides)
 * that survive app updates by construction.
 */

export const SCHEMA_VERSION = 1

/** The closed v1 field-type set. No json in v1 — its filtering is not portable. */
export const FIELD_TYPES = Object.freeze([
    "text", "number", "integer", "boolean",
    "date", "datetime", "select", "link", "table", "file"
])

/** Implicit fields every entity carries; declaring them is an error. */
export const SYSTEM_FIELDS = Object.freeze(["id", "owner", "created_at", "updated_at"])

const NAME_RE = /^[a-z][a-z0-9_]*$/
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/
const SCHEMA_KEYS = ["schemaVersion", "name", "label", "fields", "indexes", "semantic", "permissions"]
const FIELD_KEYS = ["name", "type", "label", "required", "unique", "default", "options", "target", "permlevel"]
const OVERRIDABLE = ["label", "default", "options"]
const REINDEX_MODES = ["on_update", "manual"]

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)
const clone = (x) => JSON.parse(JSON.stringify(x))
const isPlainObject = (x) => x !== null && typeof x === "object" && !Array.isArray(x)
const isI18n = (x) => isPlainObject(x) && Object.values(x).every((v) => typeof v === "string")

// ─── validate ─────────────────────────────────────────────────────────────────

/**
 * Validate a v1 Entity schema. Never throws.
 * @param {*} schema - Candidate schema document
 * @returns {{valid: true} | {valid: false, errors: Array<{code: string, path: string}>}}
 */
export function validate(schema) {
    if (!isPlainObject(schema)) return { valid: false, errors: [{ code: "E_SCHEMA", path: "" }] }
    const errors = []

    if (!("schemaVersion" in schema)) errors.push({ code: "E_VERSION", path: "/schemaVersion" })
    else if (schema.schemaVersion !== SCHEMA_VERSION)
        errors.push({ code: "E_VERSION_UNKNOWN", path: "/schemaVersion" })

    for (const key of Object.keys(schema))
        if (!SCHEMA_KEYS.includes(key)) errors.push({ code: "E_SCHEMA_KEYS", path: `/${key}` })

    if (typeof schema.name !== "string" || !NAME_RE.test(schema.name))
        errors.push({ code: "E_ENTITY_NAME", path: "/name" })

    if ("label" in schema && !isI18n(schema.label)) errors.push({ code: "E_LABEL", path: "/label" })

    if (!Array.isArray(schema.fields)) {
        errors.push({ code: "E_FIELDS", path: "/fields" })
        return { valid: false, errors }
    }

    const seen = new Set()
    schema.fields.forEach((field, i) => validateField(field, `/fields/${i}`, errors, seen))

    if ("indexes" in schema) validateIndexes(schema.indexes, seen, errors)
    if ("semantic" in schema) validateSemantic(schema.semantic, seen, errors)

    return errors.length ? { valid: false, errors } : { valid: true }
}

function validateField(field, path, errors, seen) {
    if (!isPlainObject(field)) return errors.push({ code: "E_FIELD_SHAPE", path })
    for (const key of Object.keys(field))
        if (!FIELD_KEYS.includes(key)) return errors.push({ code: "E_FIELD_KEYS", path })

    if (typeof field.name !== "string" || !NAME_RE.test(field.name))
        return errors.push({ code: "E_FIELD_NAME", path })
    if (SYSTEM_FIELDS.includes(field.name)) return errors.push({ code: "E_RESERVED_FIELD", path })
    if (seen.has(field.name)) return errors.push({ code: "E_DUP_FIELD", path })
    seen.add(field.name)

    if (!FIELD_TYPES.includes(field.type)) return errors.push({ code: "E_UNKNOWN_TYPE", path })

    if ("label" in field && !isI18n(field.label)) return errors.push({ code: "E_LABEL", path })

    if ("permlevel" in field) {
        const p = field.permlevel
        if (!Number.isInteger(p) || p < 0 || p > 9) return errors.push({ code: "E_PERMLEVEL", path })
    }

    // Per-type property rules
    if (field.type === "select") {
        if (!("options" in field)) return errors.push({ code: "E_PROP_REQUIRED", path })
        const o = field.options
        if (!Array.isArray(o) || o.length === 0 || !o.every((x) => typeof x === "string") || new Set(o).size !== o.length)
            return errors.push({ code: "E_OPTIONS", path })
    } else if ("options" in field) return errors.push({ code: "E_PROP_FORBIDDEN", path })

    if (field.type === "link" || field.type === "table") {
        if (!("target" in field)) return errors.push({ code: "E_PROP_REQUIRED", path })
        if (typeof field.target !== "string" || !NAME_RE.test(field.target))
            return errors.push({ code: "E_ENTITY_NAME", path })
    } else if ("target" in field) return errors.push({ code: "E_PROP_FORBIDDEN", path })

    if (field.type === "table" && ("unique" in field || "default" in field))
        return errors.push({ code: "E_PROP_FORBIDDEN", path })

    if ("default" in field && !defaultMatchesType(field))
        return errors.push({ code: "E_DEFAULT_TYPE", path })
}

function defaultMatchesType(field) {
    const d = field.default
    switch (field.type) {
        case "text": case "file": case "link": return typeof d === "string"
        case "number": return typeof d === "number"
        case "integer": return Number.isInteger(d)
        case "boolean": return typeof d === "boolean"
        case "date": return typeof d === "string" && DATE_RE.test(d)
        case "datetime": return typeof d === "string" && DATETIME_RE.test(d)
        case "select": return typeof d === "string" && field.options.includes(d)
        default: return false
    }
}

function validateIndexes(indexes, seen, errors) {
    if (!Array.isArray(indexes)) return errors.push({ code: "E_INDEXES", path: "/indexes" })
    indexes.forEach((index, i) => {
        const path = `/indexes/${i}`
        if (!isPlainObject(index) || !Array.isArray(index.fields))
            return errors.push({ code: "E_INDEXES", path })
        if (index.fields.length === 0) return errors.push({ code: "E_INDEX_EMPTY", path })
        for (const name of index.fields)
            if (!seen.has(name) && !SYSTEM_FIELDS.includes(name))
                return errors.push({ code: "E_INDEX_FIELD", path })
    })
}

function validateSemantic(semantic, seen, errors) {
    const path = "/semantic"
    if (!isPlainObject(semantic) || !Array.isArray(semantic.embed))
        return errors.push({ code: "E_SEMANTIC", path })
    for (const key of Object.keys(semantic))
        if (!["embed", "template", "reindex"].includes(key)) return errors.push({ code: "E_SEMANTIC", path })

    semantic.embed.forEach((entry, i) => {
        const entryPath = `${path}/embed/${i}`
        if (!isPlainObject(entry) || typeof entry.field !== "string")
            return errors.push({ code: "E_SEMANTIC", path: entryPath })
        if (!seen.has(entry.field) && !SYSTEM_FIELDS.includes(entry.field))
            return errors.push({ code: "E_SEMANTIC_FIELD", path: entryPath })
        if ("weight" in entry && (typeof entry.weight !== "number" || entry.weight <= 0))
            return errors.push({ code: "E_SEMANTIC", path: entryPath })
    })

    if ("template" in semantic && !isI18n(semantic.template))
        errors.push({ code: "E_SEMANTIC", path: `${path}/template` })
    if ("reindex" in semantic && !REINDEX_MODES.includes(semantic.reindex))
        errors.push({ code: "E_SEMANTIC", path: `${path}/reindex` })
}

// ─── diff — the Migration Engine's safety boundary ───────────────────────────

/**
 * Compare two schemas and classify every change "additive" (safe for hot DDL)
 * or "structural" (reviewed migration required). Misclassifying structural as
 * additive loses data — when in doubt, this function must say structural.
 * Renames are indistinguishable from drop+add and are reported as such; a
 * rename intent belongs in a migration file, never guessed here.
 * @param {Object} a - Previous schema
 * @param {Object} b - Next schema
 * @returns {Array<{field?: string, change: string, class: "additive"|"structural"}>}
 */
export function diff(a, b) {
    const changes = []
    const oldFields = new Map((a.fields ?? []).map((f) => [f.name, f]))
    const newFields = new Map((b.fields ?? []).map((f) => [f.name, f]))

    const removedTypes = new Set()
    for (const [name, field] of oldFields)
        if (!newFields.has(name)) {
            changes.push({ field: name, change: "removed", class: "structural" })
            removedTypes.add(field.type)
        }

    for (const [name, field] of newFields) {
        if (!oldFields.has(name)) {
            // An add paired with a same-type removal in one diff is a possible
            // rename — diff never guesses intent, so both sides go structural
            // and the migration file disambiguates (rename vs drop+add).
            const breaking =
                (field.required === true && !("default" in field)) || removedTypes.has(field.type)
            changes.push({ field: name, change: "added", class: breaking ? "structural" : "additive" })
            continue
        }
        const change = diffField(oldFields.get(name), field)
        if (change) changes.push({ field: name, ...change })
    }

    if (JSON.stringify(a.label ?? null) !== JSON.stringify(b.label ?? null))
        changes.push({ change: "label", class: "additive" })
    if (JSON.stringify(a.indexes ?? []) !== JSON.stringify(b.indexes ?? []))
        changes.push({ change: "indexes", class: "additive" })
    if (JSON.stringify(a.semantic ?? null) !== JSON.stringify(b.semantic ?? null))
        changes.push({ change: "semantic", class: "additive" })

    return changes
}

function diffField(oldField, newField) {
    const props = []
    let structural = false
    const mark = (prop, isStructural) => {
        props.push(prop)
        if (isStructural) structural = true
    }

    if (oldField.type !== newField.type) mark("type", true)
    if ((oldField.target ?? null) !== (newField.target ?? null)) mark("target", true)

    const oldOpts = oldField.options ?? null
    const newOpts = newField.options ?? null
    if (JSON.stringify(oldOpts) !== JSON.stringify(newOpts)) {
        const removedAny = (oldOpts ?? []).some((o) => !(newOpts ?? []).includes(o))
        mark("options", removedAny)
    }

    const oldRequired = oldField.required === true
    const newRequired = newField.required === true
    if (oldRequired !== newRequired) mark("required", newRequired) // tightening is structural

    const oldUnique = oldField.unique === true
    const newUnique = newField.unique === true
    if (oldUnique !== newUnique) mark("unique", newUnique) // adding unique is structural

    for (const prop of ["label", "default", "permlevel"])
        if (JSON.stringify(oldField[prop] ?? null) !== JSON.stringify(newField[prop] ?? null))
            mark(prop, false)

    if (!props.length) return null
    return { change: props.join(","), class: structural ? "structural" : "additive" }
}

// ─── merge — customize without forking ────────────────────────────────────────

/**
 * Apply a site customization ({ customFields, overrides }) onto an app's
 * schema. Custom fields live in the hard "custom_" namespace so future app
 * updates can never collide with them; overrides may touch only the closed
 * set label/default/options (options extend-only). Pure — re-applying the
 * same customization after an app update preserves it (N3).
 * @param {Object} schema - The app's schema (untouched)
 * @param {Object} customization - { customFields: [...], overrides: [...] }
 * @returns {Object} A new merged schema
 */
export function merge(schema, customization = {}) {
    const merged = clone(schema)
    const names = new Set(merged.fields.map((f) => f.name))

    for (const field of customization.customFields ?? []) {
        if (typeof field.name !== "string" || !field.name.startsWith("custom_"))
            throw err("E_CUSTOM_NAME", `custom field "${field.name}" must be namespaced custom_`)
        if (names.has(field.name)) throw err("E_CUSTOM_CONFLICT", `field "${field.name}" already exists`)
        names.add(field.name)
        merged.fields.push(clone(field))
    }

    for (const override of customization.overrides ?? []) {
        const field = merged.fields.find((f) => f.name === override.field)
        if (!field) throw err("E_OVERRIDE_FIELD", `unknown field "${override.field}"`)
        if (!OVERRIDABLE.includes(override.property))
            throw err("E_OVERRIDE_FORBIDDEN", `property "${override.property}" belongs to the app author`)
        if (override.property === "options") {
            const current = field.options ?? []
            const next = override.value
            if (!Array.isArray(next) || !current.every((o) => next.includes(o)))
                throw err("E_OVERRIDE_FORBIDDEN", "options may only be extended, never reduced")
        }
        field[override.property] = clone(override.value)
    }

    return merged
}

// ─── upgrade — the only path between versions (N4) ────────────────────────────

/**
 * Upgrade a schema of any known schemaVersion to the current one.
 * v1 is the only version today, so this is the identity on v1.
 * @param {Object} schema - Schema with a known schemaVersion
 * @returns {Object} An equivalent current-version schema
 */
export function upgrade(schema) {
    if (schema?.schemaVersion === SCHEMA_VERSION) return clone(schema)
    throw err("E_VERSION_UNKNOWN", `cannot upgrade schemaVersion ${schema?.schemaVersion}`)
}

export default { SCHEMA_VERSION, FIELD_TYPES, SYSTEM_FIELDS, validate, diff, merge, upgrade }
