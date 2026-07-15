/**
 * Data Plane CRUD API — the runtime heart of Nexus (ARCHITECTURE.md L2).
 * EVERY data access flows through here: apps, HTTP, CLI, Studio and the
 * sync fold all speak this API — there is no faster private path (N3/N5).
 *
 * One call chains everything already proven green:
 *   Model      — schema validation, row-data validation, authoritative
 *                defaults applied at insert time (migrate.js note)
 *   Permission — deny-by-default resolve() per action; permlevel field
 *                lists cut both the SELECT column set and the writable set
 *   AST        — the permission filter is injected into every query
 *                (inject → compile) and evaluated as the reference
 *                predicate on write post-images
 *   executor   — the minimal { run, all } engine contract
 *
 * Security shape:
 *  - E_NOT_FOUND is identical for "missing" and "forbidden" — existence
 *    never leaks through error channels.
 *  - Writes check the permission row-rule on BOTH images: the pre-image via
 *    the injected WHERE (you only touch rows you may see) and the
 *    post-image via the JS predicate (you cannot move a row outside your
 *    own permission scope — docs/sync-design.md §6).
 *  - System fields (id/owner/created_at/updated_at) are never writable
 *    through payloads; owner is stamped from ctx.user, timestamps from the
 *    injected clock. create() accepts an explicit id only via options —
 *    the seam the sync fold replays through (fixed rowIds).
 *
 * ctx = { user, roles, policies, shares } — the policies already assigned
 * to the requesting user (assignment resolution is the auth layer's job,
 * per the Permission spec).
 */

import { validate as validateSchema, SYSTEM_FIELDS } from "../model/Model.js"
import * as Permission from "../permission/Permission.js"
import * as AST from "../ast/AST.js"
import { createCompiler } from "./kysely.js"
import { applyWhere } from "./compile.js"
import { ulid } from "./ulid.js"

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const matchAll = { astVersion: 1, root: null }
const idDoc = (id) => ({ astVersion: 1, root: { field: "id", operator: "eq", value: id } })

export class DataPlane {
    /**
     * @param {Object} config
     * @param {{run: Function, all: Function}} config.executor - Engine executor
     * @param {Array} config.schemas - Valid Model Schema v1 documents
     * @param {string} [config.dialect] - sqlite|turso|postgres|mysql
     * @param {Function} [config.now] - Injected clock → ISO string
     */
    constructor({ executor, schemas = [], dialect = "sqlite", now } = {}) {
        if (!executor) throw err("E_EXECUTOR", "an executor { run, all } is required")
        this.executor = executor
        this.dialect = dialect
        this.family = dialect === "turso" ? "sqlite" : dialect
        this.kysely = createCompiler(dialect)
        this.now = now ?? (() => new Date().toISOString())
        this.schemas = new Map()
        for (const schema of schemas) {
            const result = validateSchema(schema)
            if (!result.valid) throw err("E_INVALID", JSON.stringify(result.errors))
            this.schemas.set(schema.name, schema)
        }
    }

    schema(entity) {
        const schema = this.schemas.get(entity)
        if (!schema) throw err("E_ENTITY", `unknown entity "${entity}"`)
        return schema
    }

    // ─── permission gate — one per operation ─────────────────────────────────

    #gate(entity, action, ctx = {}) {
        const schema = this.schema(entity)
        const permCtx = { entity, action, user: ctx.user, roles: ctx.roles ?? [], now: this.now() }
        const { allowed, filter } = Permission.resolve(ctx.policies ?? [], permCtx, ctx.shares ?? [])
        if (!allowed) throw err("E_FORBIDDEN", `${action} on ${entity}`)
        const fields = Permission.fields(ctx.policies ?? [], permCtx, schema)
        return { schema, filter, fields }
    }

    // ─── row-data validation & shaping ───────────────────────────────────────

    #validateData(schema, data, { partial, writable }) {
        if (data === null || typeof data !== "object" || Array.isArray(data)) throw err("E_DATA", "payload must be an object")
        const byName = new Map(schema.fields.map((f) => [f.name, f]))
        for (const [key, value] of Object.entries(data)) {
            if (SYSTEM_FIELDS.includes(key)) throw err("E_FIELD_SYSTEM", `"${key}" is system-managed`)
            const field = byName.get(key)
            if (!field || field.type === "table") throw err("E_FIELD_UNKNOWN", `"${key}"`)
            if (!writable.includes(key)) throw err("E_FIELD_FORBIDDEN", `"${key}" is above your permission level`)
            if (value === null || value === undefined) {
                if (field.required === true) throw err("E_REQUIRED", `"${key}"`)
                continue
            }
            this.#checkType(field, value)
        }
        if (!partial)
            for (const field of schema.fields) {
                if (field.type === "table" || field.required !== true) continue
                const provided = data[field.name] !== undefined && data[field.name] !== null
                if (!provided && !("default" in field)) throw err("E_REQUIRED", `"${field.name}"`)
            }
    }

    #checkType(field, value) {
        const fail = () => err("E_VALUE_TYPE", `"${field.name}" expects ${field.type}`)
        switch (field.type) {
            case "text": case "file": case "link":
                if (typeof value !== "string") throw fail()
                return
            case "integer":
                if (!Number.isInteger(value)) throw fail()
                return
            case "number":
                if (typeof value !== "number") throw fail()
                return
            case "boolean":
                if (typeof value !== "boolean") throw fail()
                return
            case "date":
                if (typeof value !== "string" || !DATE_RE.test(value)) throw fail()
                return
            case "datetime":
                if (typeof value !== "string" || !DATETIME_RE.test(value)) throw fail()
                return
            case "select":
                if (typeof value !== "string") throw fail()
                if (!field.options.includes(value)) throw err("E_VALUE_OPTION", `"${value}" not in ${field.name} options`)
                return
        }
    }

    // Engine ↔ JS value shaping (the sqlite/mysql families store booleans as 1/0)
    #toBinding(value) {
        if (this.family === "postgres") return value ?? null
        return value === true ? 1 : value === false ? 0 : value ?? null
    }

    #normalize(schema, row) {
        if (!row) return row
        const out = { ...row }
        if (this.family !== "postgres")
            for (const field of schema.fields)
                if (field.type === "boolean" && out[field.name] !== null && out[field.name] !== undefined)
                    out[field.name] = out[field.name] === 1 || out[field.name] === true
        return out
    }

    #run(compiled) {
        return this.executor.run(compiled.sql, [...compiled.parameters].map((v) => this.#toBinding(v)))
    }

    #all(compiled) {
        return this.executor.all(compiled.sql, [...compiled.parameters].map((v) => this.#toBinding(v)))
    }

    // ─── CRUD ─────────────────────────────────────────────────────────────────

    /** Create a row. options.id is the sync-fold seam (fixed rowIds on replay). */
    async create(entity, data, ctx = {}, options = {}) {
        const { schema, filter, fields } = this.#gate(entity, "create", ctx)
        this.#validateData(schema, data, { partial: false, writable: fields })

        const stamp = this.now()
        const row = { id: options.id ?? ulid(), owner: ctx.user ?? null, created_at: stamp, updated_at: stamp }
        for (const field of schema.fields) {
            if (field.type === "table") continue
            if (data[field.name] !== undefined) row[field.name] = data[field.name]
            else if ("default" in field) row[field.name] = field.default // authoritative default
            else row[field.name] = null
        }

        // Post-image must sit inside the caller's own permission scope
        if (filter !== null && !AST.predicate(filter)(row)) throw err("E_FORBIDDEN_ROW", "row falls outside your permission rule")

        const values = Object.fromEntries(Object.entries(row).map(([k, v]) => [k, this.#toBinding(v)]))
        await this.#run(this.kysely.insertInto(entity).values(values).compile())
        return row
    }

    /** Read one row by id — null when missing OR forbidden (no existence leak). */
    async get(entity, id, ctx = {}) {
        const { schema, filter, fields } = this.#gate(entity, "read", ctx)
        const where = AST.inject(idDoc(id), filter ?? matchAll)
        const query = applyWhere(this.kysely.selectFrom(entity).select(fields), where, { dialect: this.dialect })
        const rows = await this.#all(query.compile())
        return rows.length ? this.#normalize(schema, rows[0]) : null
    }

    /**
     * List rows. The caller's filter (an AST document, variables welcome) is
     * resolved, then INJECTED with the permission filter — it can only ever
     * narrow, never escape.
     * @param {Object} [options] - { filter, limit, offset, orderBy: [{field, dir}] }
     */
    async list(entity, options = {}, ctx = {}) {
        const { schema, filter, fields } = this.#gate(entity, "read", ctx)
        const astCtx = { user: ctx.user, roles: ctx.roles ?? [], now: this.now() }
        const userFilter = options.filter ? AST.resolve(options.filter, astCtx) : matchAll
        const where = AST.inject(userFilter, filter ?? matchAll)

        let query = applyWhere(this.kysely.selectFrom(entity).select(fields), where, { dialect: this.dialect })
        for (const order of options.orderBy ?? []) {
            if (!fields.includes(order.field)) throw err("E_FIELD_FORBIDDEN", `orderBy "${order.field}"`)
            const dir = order.dir ?? "asc"
            if (dir !== "asc" && dir !== "desc") throw err("E_ORDER", `direction "${dir}"`)
            query = query.orderBy(order.field, dir)
        }
        if (options.limit !== undefined) query = query.limit(options.limit)
        if (options.offset !== undefined) query = query.offset(options.offset)

        const rows = await this.#all(query.compile())
        return rows.map((row) => this.#normalize(schema, row))
    }

    /** Patch a row. Pre-image gated by the injected WHERE, post-image by the predicate. */
    async update(entity, id, patch, ctx = {}) {
        const { schema, filter, fields } = this.#gate(entity, "write", ctx)
        this.#validateData(schema, patch, { partial: true, writable: fields })

        const where = AST.inject(idDoc(id), filter ?? matchAll)
        const query = applyWhere(this.kysely.selectFrom(entity).selectAll(), where, { dialect: this.dialect })
        const rows = await this.#all(query.compile())
        if (!rows.length) throw err("E_NOT_FOUND", `${entity}/${id}`)
        const current = this.#normalize(schema, rows[0])

        const post = { ...current, ...patch, updated_at: this.now() }
        if (filter !== null && !AST.predicate(filter)(post)) throw err("E_FORBIDDEN_ROW", "patch would move the row outside your permission rule")

        const set = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, this.#toBinding(v ?? null)]))
        set.updated_at = post.updated_at
        await this.#run(this.kysely.updateTable(entity).set(set).where("id", "=", id).compile())
        return post
    }

    /** Delete a row — same not-found/forbidden opacity as update. */
    async remove(entity, id, ctx = {}) {
        const { filter } = this.#gate(entity, "delete", ctx)
        const where = AST.inject(idDoc(id), filter ?? matchAll)
        const query = applyWhere(this.kysely.selectFrom(entity).select(["id"]), where, { dialect: this.dialect })
        const rows = await this.#all(query.compile())
        if (!rows.length) throw err("E_NOT_FOUND", `${entity}/${id}`)
        await this.#run(this.kysely.deleteFrom(entity).where("id", "=", id).compile())
        return true
    }
}

export default DataPlane
