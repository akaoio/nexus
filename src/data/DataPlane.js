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
import { serializeRow, cosine, textScore, rrf } from "../semantic/semantic.js"
import { translate, ruleProvider } from "../nl/nl.js"

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/
const DATETIME_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/

const matchAll = { astVersion: 1, root: null }
const idDoc = (id) => ({ astVersion: 1, root: { field: "id", operator: "eq", value: id } })

export class DataPlane {
    /** The hard ceiling on any list/search result set (SEC-05, DoS bound). */
    static MAX_LIMIT = 1000

    /**
     * @param {Object} config
     * @param {{run: Function, all: Function}} config.executor - Engine executor
     * @param {Array} config.schemas - Valid Model Schema v1 documents
     * @param {string} [config.dialect] - sqlite|turso|postgres|mysql
     * @param {Function} [config.now] - Injected clock → ISO string
     */
    #embeddingsReady = false
    #vecReady = new Set()

    constructor({ executor, schemas = [], dialect = "sqlite", now, hooks = null, embedder = null } = {}) {
        if (!executor) throw err("E_EXECUTOR", "an executor { run, all } is required")
        this.executor = executor
        this.dialect = dialect
        this.family = dialect === "turso" ? "sqlite" : dialect
        this.kysely = createCompiler(dialect)
        this.now = now ?? (() => new Date().toISOString())
        // App hooks (Extensions): before-hooks may mutate their payload or
        // throw to veto; after-hooks observe. null = no hooks.
        this.hooks = hooks
        // Embedding provider (§4.6b) — pluggable; embeddings are DERIVED
        // data maintained on the write path, never synced (recomputable).
        this.embedder = embedder
        // NL→AST provider (§4.6f) — deterministic rule parser by default; a
        // real LLM provider plugs in with the same signature. Whatever it
        // returns is validated and runs the full permission pipeline.
        this.nlProvider = arguments[0]?.nlProvider ?? ruleProvider
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
        if (this.hooks) {
            const payload = { data }
            await this.hooks.run("before:create", entity, payload, ctx)
            data = payload.data
        }
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
        await this.#maintainEmbedding(entity, row)
        if (this.hooks) await this.hooks.run("after:create", entity, { row }, ctx)
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
        // SECURITY: the caller may only FILTER by fields it may READ — else a
        // permlevel-gated field becomes an oracle (filter by it, infer values
        // from which rows return). The permission filter itself is trusted.
        this.#assertFilterFields(userFilter.root, fields)
        const where = AST.inject(userFilter, filter ?? matchAll)

        let query = applyWhere(this.kysely.selectFrom(entity).select(fields), where, { dialect: this.dialect })
        for (const order of options.orderBy ?? []) {
            if (!fields.includes(order.field)) throw err("E_FIELD_FORBIDDEN", `orderBy "${order.field}"`)
            const dir = order.dir ?? "asc"
            if (dir !== "asc" && dir !== "desc") throw err("E_ORDER", `direction "${dir}"`)
            query = query.orderBy(order.field, dir)
        }
        // SEC-05: a result set is ALWAYS bounded — an unbounded or absurd
        // limit is clamped to MAX_LIMIT so no request can exhaust memory.
        const requested = Number.isInteger(options.limit) && options.limit >= 0 ? options.limit : DataPlane.MAX_LIMIT
        query = query.limit(Math.min(requested, DataPlane.MAX_LIMIT))
        if (options.offset !== undefined) query = query.offset(options.offset)

        const rows = await this.#all(query.compile())
        return rows.map((row) => this.#normalize(schema, row))
    }

    /** Patch a row. Pre-image gated by the injected WHERE, post-image by the predicate. */
    async update(entity, id, patch, ctx = {}) {
        const { schema, filter, fields } = this.#gate(entity, "write", ctx)
        if (this.hooks) {
            const payload = { id, patch }
            await this.hooks.run("before:update", entity, payload, ctx)
            patch = payload.patch
        }
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
        await this.#maintainEmbedding(entity, post)
        if (this.hooks) await this.hooks.run("after:update", entity, { row: post }, ctx)
        return post
    }

    /** Delete a row — same not-found/forbidden opacity as update. */
    async remove(entity, id, ctx = {}) {
        const { filter } = this.#gate(entity, "delete", ctx)
        const where = AST.inject(idDoc(id), filter ?? matchAll)
        const query = applyWhere(this.kysely.selectFrom(entity).select(["id"]), where, { dialect: this.dialect })
        const rows = await this.#all(query.compile())
        if (!rows.length) throw err("E_NOT_FOUND", `${entity}/${id}`)
        if (this.hooks) await this.hooks.run("before:remove", entity, { id }, ctx)
        await this.#run(this.kysely.deleteFrom(entity).where("id", "=", id).compile())
        await this.#dropEmbedding(entity, id)
        if (this.hooks) await this.hooks.run("after:remove", entity, { id }, ctx)
        return true
    }

    /** Every field a caller's filter references must be in its readable set. */
    #assertFilterFields(node, fields) {
        if (!node) return
        if (node.op) return node.children.forEach((c) => this.#assertFilterFields(c, fields))
        const base = node.field.split(".")[0]
        if (!fields.includes(base)) throw err("E_FIELD_FORBIDDEN", `cannot filter by "${node.field}" — above your permission level`)
    }

    // ─── semantic search (§4.6) ───────────────────────────────────────────────

    async #ensureEmbeddings() {
        if (this.#embeddingsReady) return
        await this.executor.run(
            `CREATE TABLE IF NOT EXISTS _nexus_embeddings (entity TEXT, row_id TEXT, model TEXT, vector TEXT, PRIMARY KEY (entity, row_id))`
        )
        this.#embeddingsReady = true
    }

    // Float32 → the byte blob sqlite-vec stores.
    #f32(vector) {
        return new Uint8Array(new Float32Array(vector).buffer)
    }

    async #ensureVec(entity, dims) {
        if (this.#vecReady.has(entity)) return
        await this.executor.run(`CREATE VIRTUAL TABLE IF NOT EXISTS "_nexus_vec_${entity}" USING vec0(row_id text, embedding float[${dims}])`)
        this.#vecReady.add(entity)
    }

    async #maintainEmbedding(entity, row) {
        const schema = this.schemas.get(entity)
        if (!this.embedder || !schema?.semantic) return
        await this.#ensureEmbeddings()
        const [vector] = await this.embedder.embed([serializeRow(schema, row)])
        await this.executor.run(`DELETE FROM _nexus_embeddings WHERE entity = ? AND row_id = ?`, [entity, row.id])
        await this.executor.run(`INSERT INTO _nexus_embeddings (entity, row_id, model, vector) VALUES (?, ?, ?, ?)`, [
            entity, row.id, `${this.embedder.name}@${this.embedder.version}`, JSON.stringify(vector)
        ])
        // sqlite-vec ANN index (real KNN), when the engine loaded the extension
        if (this.executor.vec) {
            await this.#ensureVec(entity, vector.length)
            await this.executor.run(`DELETE FROM "_nexus_vec_${entity}" WHERE row_id = ?`, [row.id])
            await this.executor.run(`INSERT INTO "_nexus_vec_${entity}"(row_id, embedding) VALUES (?, ?)`, [row.id, this.#f32(vector)])
        }
    }

    async #dropEmbedding(entity, id) {
        if (!this.embedder) return
        await this.#ensureEmbeddings()
        await this.executor.run(`DELETE FROM _nexus_embeddings WHERE entity = ? AND row_id = ?`, [entity, id])
        if (this.executor.vec && this.#vecReady.has(entity))
            await this.executor.run(`DELETE FROM "_nexus_vec_${entity}" WHERE row_id = ?`, [id])
    }

    /**
     * Natural-language query (§4.6f): translate the phrase to a validated AST
     * against this entity's schema, then run it through list() — so
     * permission injection applies exactly as to any query. An LLM can shape
     * the filter but can never widen access or reference an unknown field.
     * @param {string} query - Natural-language phrase
     * @param {Object} [options] - { limit, offset, orderBy }
     * @returns {Promise<{filter: Object, rows: Array}>}
     */
    async ask(entity, query, ctx = {}, options = {}) {
        const schema = this.schema(entity)
        const filter = await translate(query, schema, this.nlProvider)
        const rows = await this.list(entity, { ...options, filter }, ctx)
        return { filter, rows }
    }

    /**
     * Hybrid search (§4.6e): the caller's filter + permission narrow the
     * CANDIDATES (through list() — permission is enforced before any
     * ranking; no row a plain query could not see can surface here), then
     * text/vector/hybrid RANKING orders them. Brute-force cosine is the
     * declared engine-portable baseline; ANN capabilities upgrade per
     * engine behind this same contract.
     * @param {Object} options - { query, mode = "hybrid"|"text"|"vector", filter, k = 10 }
     * @returns {Promise<Array<{score: number, row: Object}>>}
     */
    async search(entity, options = {}, ctx = {}) {
        const { query = "", mode = "hybrid", k = 10 } = options
        const schema = this.schema(entity)
        if (!["text", "vector", "hybrid"].includes(mode)) throw err("E_MODE", `unknown search mode "${mode}"`)
        const wantVector = mode !== "text"
        if (wantVector && !this.embedder) {
            if (mode === "vector") throw err("E_EMBEDDER", "no embedding provider configured")
        }

        const candidates = await this.list(entity, { filter: options.filter }, ctx)
        if (!candidates.length || !String(query).trim()) return []

        const textRanked = candidates
            .map((row) => ({ id: row.id, score: textScore(serializeRow(schema, row), query) }))
            .filter((r) => r.score > 0)
            .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))

        let vectorRanked = []
        if (wantVector && this.embedder) {
            const [queryVector] = await this.embedder.embed([String(query)])
            const candIds = new Set(candidates.map((r) => r.id))
            if (this.executor.vec && this.#vecReady.has(entity)) {
                // Real sqlite-vec ANN: KNN over-fetches, then we keep only the
                // permission-visible candidates — ranking stays inside
                // permission (SEM-06 holds; over-fetch covers the attrition).
                const over = Math.min(candidates.length + k * 8 + 8, 1000)
                const knn = await this.executor.all(
                    `SELECT row_id, distance FROM "_nexus_vec_${entity}" WHERE embedding MATCH ? AND k = ${over} ORDER BY distance`,
                    [this.#f32(queryVector)]
                )
                vectorRanked = knn
                    .filter((r) => candIds.has(r.row_id))
                    .map((r) => ({ id: r.row_id, score: 1 / (1 + r.distance) }))
            } else {
                await this.#ensureEmbeddings()
                const stored = await this.executor.all(`SELECT row_id, vector FROM _nexus_embeddings WHERE entity = ?`, [entity])
                const vectors = new Map(stored.map((r) => [r.row_id, JSON.parse(r.vector)]))
                vectorRanked = candidates
                    .filter((row) => vectors.has(row.id))
                    .map((row) => ({ id: row.id, score: cosine(queryVector, vectors.get(row.id)) }))
                    .filter((r) => r.score > 0)
                    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : 1))
            }
        }

        let fused
        if (mode === "text") fused = textRanked
        else if (mode === "vector") fused = vectorRanked
        else fused = rrf([textRanked.map((r) => r.id), vectorRanked.map((r) => r.id)])

        const byId = new Map(candidates.map((row) => [row.id, row]))
        return fused.slice(0, k).map((r) => ({ score: r.score, row: byId.get(r.id) }))
    }
}

export default DataPlane
