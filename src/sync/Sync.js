/**
 * Sync core — the ZEN event log → SQL projection of docs/sync-design.md,
 * implemented to the SYNC-* clauses (which were written red first).
 *
 * The pieces: HLC (total order §4.1), Event v1 (canonical form,
 * content-addressed id, ZEN secp256k1 signatures — vendored, first-party),
 * the four verification gates with QUARANTINE (never discard a gate-4
 * failure; retry after the world changes), the upgradeRow chain (§7 —
 * events are immutable, upgrades happen at fold time, every time), and the
 * row-level REFOLD (§4.2) that makes confluence a structural property:
 * the SQL state depends on the event SET, never the arrival order.
 *
 * Scope, honestly: gate 3 (PEN at the graph layer) and checkpoints/pruning
 * (§8, needs the arbiter role) are deferred integrations — gate 4 re-checks
 * permission here regardless. The default trust model is trust-all
 * (one user's devices syncing their own data); multi-party sites supply a
 * policiesFor(author) resolver and the deny-by-default engine takes over.
 * Transport is a callback (onemit) — the in-memory bus in tests, the ZEN
 * graph adapter when the network layer lands.
 */

import { sha256 } from "../kernel/Utils.js"
import { tableDDL } from "../data/ddl.js"
import { createCompiler } from "../data/kysely.js"
import * as Permission from "../permission/Permission.js"

const ZEN = (await import("../../vendor/zen/zen.js")).default

export const EVENT_VERSION = 1
const OPS = ["create", "update", "delete"]
const ACTION_OF = { create: "create", update: "write", delete: "delete" }

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

// ─── canonical form & content address ─────────────────────────────────────────

function stableStringify(x) {
    if (x === null || typeof x !== "object") return JSON.stringify(x)
    if (Array.isArray(x)) return "[" + x.map(stableStringify).join(",") + "]"
    return "{" + Object.keys(x).sort().map((k) => JSON.stringify(k) + ":" + stableStringify(x[k])).join(",") + "}"
}

/** The signable form: every key sorted, id and sig excluded. */
export function canonical(event) {
    const { id, sig, ...rest } = event
    return stableStringify(rest)
}

const BASE62 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz"

/** base62(SHA-256(canonical)) — the immutable content address. */
export function contentId(canonicalText) {
    let n = BigInt("0x" + sha256(canonicalText))
    let out = ""
    while (n > 0n) {
        out = BASE62[Number(n % 62n)] + out
        n /= 62n
    }
    return out || "0"
}

/** Build and sign an Event v1. */
export async function createEvent(spec, pair) {
    if (!OPS.includes(spec.op)) throw err("E_OP", `unknown op "${spec.op}"`)
    const event = {
        eventVersion: EVENT_VERSION,
        site: spec.site,
        entity: spec.entity,
        schemaVersion: spec.schemaVersion ?? 1,
        op: spec.op,
        rowId: spec.rowId,
        data: spec.data ?? {},
        group: spec.group ?? null,
        author: pair.pub,
        ts: spec.ts
    }
    const text = canonical(event)
    event.id = contentId(text)
    event.sig = await ZEN.sign(text, pair)
    return event
}

/** Gates 1 + 2: the signature binds the author to exactly this content. */
export async function verifyEvent(event) {
    if (event?.eventVersion !== EVENT_VERSION) return false
    const text = canonical(event)
    if (contentId(text) !== event.id) return false
    try {
        const message = await ZEN.verify(event.sig, event.author)
        if (message === false || message === null || message === undefined) return false
        // ZEN auto-parses JSON messages back into objects — re-canonicalize
        const restored = typeof message === "string" ? message : stableStringify(message)
        return restored === text
    } catch {
        return false
    }
}

// ─── HLC — the total order (§4.1) ─────────────────────────────────────────────

export class HLC {
    #millis = 0
    #counter = 0

    /** A timestamp that never runs backwards, even when the wall clock does. */
    next(physical = Date.now()) {
        if (physical > this.#millis) {
            this.#millis = physical
            this.#counter = 0
        } else this.#counter++
        return { millis: this.#millis, counter: this.#counter }
    }

    /** Merge a remote timestamp — local time never falls behind what it saw. */
    receive(ts) {
        if (ts.millis > this.#millis || (ts.millis === this.#millis && ts.counter > this.#counter)) {
            this.#millis = ts.millis
            this.#counter = ts.counter
        }
    }
}

/** (millis, counter, author, id) — antisymmetric, transitive, tie-free. */
export function compareEvents(a, b) {
    if (a.ts.millis !== b.ts.millis) return a.ts.millis < b.ts.millis ? -1 : 1
    if (a.ts.counter !== b.ts.counter) return a.ts.counter < b.ts.counter ? -1 : 1
    if (a.author !== b.author) return a.author < b.author ? -1 : 1
    if (a.id !== b.id) return a.id < b.id ? -1 : 1
    return 0
}

// ─── the engine ───────────────────────────────────────────────────────────────

export class SyncEngine {
    /**
     * @param {Object} config
     * @param {{run, all}} config.executor - Engine executor
     * @param {Array} config.schemas - Model Schema v1 documents
     * @param {string} config.site - Site id carried by emitted events
     * @param {Function} [config.policiesFor] - (author) → policies array, or
     *   null for trust-all. Absent = trust-all (single-user device sync).
     * @param {Object} [config.versions] - entity → current schema revision
     * @param {Object} [config.upgraders] - entity → { fromVersion: (data)=>data }
     */
    constructor({ executor, dialect = "sqlite", schemas = [], site, policiesFor, versions = {}, upgraders = {} } = {}) {
        this.executor = executor
        this.dialect = dialect
        this.kysely = createCompiler(dialect)
        this.site = site
        this.schemas = new Map(schemas.map((s) => [s.name, s]))
        this.policiesFor = policiesFor ?? null
        this.versions = { ...versions }
        this.upgraders = upgraders
        this.clock = new HLC()
        this.onemit = null
        this.ready = this.#init(schemas)
    }

    async #init(schemas) {
        await this.executor.run(
            `CREATE TABLE IF NOT EXISTS _nexus_events (id TEXT PRIMARY KEY, entity TEXT, row_id TEXT, millis INTEGER, counter INTEGER, author TEXT, payload TEXT)`
        )
        await this.executor.run(`CREATE TABLE IF NOT EXISTS _nexus_quarantine (id TEXT PRIMARY KEY, reason TEXT, payload TEXT)`)
        for (const schema of schemas)
            for (const builder of tableDDL(this.kysely, schema, { dialect: this.dialect, ifNotExists: true })) {
                const compiled = builder.compile()
                await this.executor.run(compiled.sql, [...compiled.parameters])
            }
    }

    /** The local write path: build, sign, apply optimistically, emit. */
    async append(spec, pair) {
        const ts = this.clock.next()
        const event = await createEvent(
            { site: this.site, schemaVersion: this.versions[spec.entity] ?? 1, ...spec, ts },
            pair
        )
        const result = await this.ingest(event)
        if (result.status !== "applied") throw err("E_APPEND", `local event did not apply: ${JSON.stringify(result)}`)
        this.onemit?.(event)
        return { event, result }
    }

    /** The four gates → store → refold. Never throws on bad input; reports. */
    async ingest(event) {
        if (event?.eventVersion !== EVENT_VERSION)
            return { status: "rejected", reason: `E_VERSION_UNKNOWN: eventVersion ${event?.eventVersion}` }
        if (!(await verifyEvent(event))) return { status: "rejected", reason: "E_VERIFY: signature or content address failed" }

        const seen = await this.executor.all(`SELECT id FROM _nexus_events WHERE id = ?`, [event.id])
        if (seen.length) return { status: "duplicate" }

        const gate = await this.#gate4(event)
        if (gate) {
            await this.executor.run(`INSERT OR REPLACE INTO _nexus_quarantine (id, reason, payload) VALUES (?, ?, ?)`, [
                event.id, gate, JSON.stringify(event)
            ])
            return { status: "quarantined", reason: gate }
        }

        this.clock.receive(event.ts)
        await this.executor.run(`DELETE FROM _nexus_quarantine WHERE id = ?`, [event.id])
        await this.executor.run(`INSERT INTO _nexus_events (id, entity, row_id, millis, counter, author, payload) VALUES (?, ?, ?, ?, ?, ?, ?)`, [
            event.id, event.entity, event.rowId, event.ts.millis, event.ts.counter, event.author, JSON.stringify(event)
        ])
        await this.#refold(event.entity, event.rowId)
        return { status: "applied" }
    }

    /** Gate 4 — the Nexus checks: entity, versions, fields, permission. */
    async #gate4(event) {
        const schema = this.schemas.get(event.entity)
        if (!schema) return `E_ENTITY: unknown entity "${event.entity}"`

        const current = this.versions[event.entity] ?? 1
        if (event.schemaVersion > current) return `E_FUTURE: event schemaVersion ${event.schemaVersion} > local ${current}`
        for (let v = event.schemaVersion; v < current; v++)
            if (typeof this.upgraders[event.entity]?.[v] !== "function")
                return `E_UPGRADER: no upgrader ${event.entity} v${v}→v${v + 1}`

        const fields = new Set(schema.fields.filter((f) => f.type !== "table").map((f) => f.name))
        for (const key of Object.keys(event.data ?? {}))
            if (!fields.has(key)) return `E_FIELD: unknown field "${key}"`

        if (this.policiesFor) {
            const policies = this.policiesFor(event.author)
            if (policies !== null) {
                try {
                    const { allowed } = Permission.resolve(policies, {
                        entity: event.entity,
                        action: ACTION_OF[event.op],
                        user: event.author,
                        roles: []
                    })
                    if (!allowed) return `E_FORBIDDEN: ${event.author} may not ${event.op} ${event.entity}`
                } catch (error) {
                    return `E_POLICY: ${error.message}`
                }
            }
        }
        return null
    }

    /** Upgrade an event's data through the chain — at fold time, every time (§7). */
    #upgrade(event) {
        const current = this.versions[event.entity] ?? 1
        let data = { ...event.data }
        for (let v = event.schemaVersion; v < current; v++) data = this.upgraders[event.entity][v](data)
        return data
    }

    /** §4.2 — gather, sort, fold from scratch: confluence by construction. */
    async #refold(entity, rowId) {
        const schema = this.schemas.get(entity)
        const rows = await this.executor.all(`SELECT payload FROM _nexus_events WHERE entity = ? AND row_id = ?`, [entity, rowId])
        const events = rows.map((r) => JSON.parse(r.payload)).sort(compareEvents)

        let state = null
        for (const event of events) {
            const data = this.#upgrade(event)
            if (event.op === "create") {
                state = { id: rowId, owner: event.author, created_at: iso(event.ts), updated_at: iso(event.ts) }
                for (const field of schema.fields) {
                    if (field.type === "table") continue
                    state[field.name] = data[field.name] !== undefined ? data[field.name] : "default" in field ? field.default : null
                }
            } else if (event.op === "update") {
                if (state === null) continue // update-before-create: wait for the base
                Object.assign(state, data)
                state.updated_at = iso(event.ts)
            } else if (event.op === "delete") state = null
        }

        await this.executor.run(`DELETE FROM "${entity}" WHERE id = ?`, [rowId])
        if (state !== null) {
            const values = Object.fromEntries(Object.entries(state).map(([k, v]) => [k, v === true ? 1 : v === false ? 0 : v ?? null]))
            const compiled = this.kysely.insertInto(entity).values(values).compile()
            await this.executor.run(compiled.sql, [...compiled.parameters])
        }
    }

    async quarantined() {
        return this.executor.all(`SELECT id, reason, payload FROM _nexus_quarantine`)
    }

    /** Retry everything held back — after a migrate or a policy change. */
    async retryQuarantine() {
        const held = await this.quarantined()
        let applied = 0
        for (const row of held) {
            await this.executor.run(`DELETE FROM _nexus_quarantine WHERE id = ?`, [row.id])
            const result = await this.ingest(JSON.parse(row.payload))
            if (result.status === "applied") applied++
        }
        return { applied, remaining: (await this.quarantined()).length }
    }
}

const iso = (ts) => new Date(ts.millis).toISOString()

export default { EVENT_VERSION, canonical, contentId, createEvent, verifyEvent, HLC, compareEvents, SyncEngine }
