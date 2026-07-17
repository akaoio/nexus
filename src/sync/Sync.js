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
 * Scope: gate 3 (PEN) compiles the entity set to a REAL ZEN PEN policy and
 * rejects structurally-invalid writes at ingest via ZEN's policy VM (opt-in,
 * see PenPolicy.js); gate 4 re-checks full permission regardless. Checkpoints
 * & compaction (§8) and snapshot bootstrap (§9) are implemented with the
 * arbiter role. The default trust model is trust-all (one user's devices
 * syncing their own data); multi-party sites supply a policiesFor(author)
 * resolver and the deny-by-default engine takes over. Transport is a callback
 * (onemit) — the in-memory bus in tests, the real ZEN graph mesh in
 * ZenTransport.js.
 */

import { sha256 } from "../kernel/Utils.js"
import { tableDDL } from "../data/ddl.js"
import { createCompiler } from "../data/kysely.js"
import * as Permission from "../permission/Permission.js"
import { logSoul, authorizeWrite } from "./PenPolicy.js"

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

/** HLC "≤": is timestamp a at or before b in the §4.1 order? */
export function hlcLeq(a, b) {
    if (a.millis !== b.millis) return a.millis < b.millis
    return a.counter <= b.counter
}

// ─── checkpoint merkle root (§8) ──────────────────────────────────────────────

/** A binary Merkle root over already-hashed leaves (hex). "EMPTY" when none. */
export function merkleRoot(leafHashes) {
    let level = [...leafHashes]
    if (!level.length) return "EMPTY"
    while (level.length > 1) {
        const next = []
        for (let i = 0; i < level.length; i += 2)
            next.push(i + 1 < level.length ? sha256(level[i] + level[i + 1]) : level[i])
        level = next
    }
    return level[0]
}

/**
 * The deterministic state root over a set of folded row states: each
 * { entity, rowId, state } hashed canonically, the leaves sorted (order-free),
 * combined into a Merkle root. Two peers with the same rows produce the same
 * root byte-for-byte; any divergence changes it.
 */
export function stateRootOf(states) {
    const leaves = states
        .map((s) => sha256(stableStringify({ entity: s.entity, rowId: s.rowId, state: s.state })))
        .sort()
    return merkleRoot(leaves)
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
    constructor({ executor, dialect = "sqlite", schemas = [], site, policiesFor, versions = {}, upgraders = {}, arbiter = null, penGate = false } = {}) {
        this.executor = executor
        this.dialect = dialect
        this.kysely = createCompiler(dialect)
        this.site = site
        this.schemas = new Map(schemas.map((s) => [s.name, s]))
        this.policiesFor = policiesFor ?? null
        this.versions = { ...versions }
        this.upgraders = upgraders
        // The arbiter/archive pubkey declared in site config (§8). Absent =
        // no authority to prune: disk is cheaper than data, so a peer without a
        // configured arbiter never compacts. When set, only checkpoints signed
        // by THIS key are honored.
        this.arbiter = arbiter
        // The HLC key of the latest applied checkpoint (§8) — the fold horizon:
        // events at or before it live in the checkpoint base, not the log.
        this.checkpointUpto = null
        // Gate 3 (§3/§5): when enabled, a real ZEN PEN policy compiled from the
        // known entities rejects structurally-invalid writes at ingest, using
        // ZEN's policy VM — the same bytecode a plain relay would enforce.
        this.penGate = penGate
        this.penBytecode = null
        this.clock = new HLC()
        this.onemit = null
        this.ready = this.#init(schemas)
    }

    async #init(schemas) {
        await this.executor.run(
            `CREATE TABLE IF NOT EXISTS _nexus_events (id TEXT PRIMARY KEY, entity TEXT, row_id TEXT, millis INTEGER, counter INTEGER, author TEXT, payload TEXT)`
        )
        await this.executor.run(`CREATE TABLE IF NOT EXISTS _nexus_quarantine (id TEXT PRIMARY KEY, reason TEXT, payload TEXT)`)
        // Checkpoint state (§8): the signed checkpoint ledger, the per-row
        // folded base at the horizon (the snapshot's contents), and the set of
        // event ids the snapshot covers (to tell a re-delivered pruned event
        // from a genuinely new historical one).
        await this.executor.run(`CREATE TABLE IF NOT EXISTS _nexus_checkpoints (upto_millis INTEGER, upto_counter INTEGER, state_root TEXT, snapshot_ref TEXT, payload TEXT, status TEXT)`)
        await this.executor.run(`CREATE TABLE IF NOT EXISTS _nexus_checkpoint_base (entity TEXT, row_id TEXT, state TEXT, PRIMARY KEY (entity, row_id))`)
        await this.executor.run(`CREATE TABLE IF NOT EXISTS _nexus_checkpoint_covered (event_id TEXT PRIMARY KEY)`)
        for (const schema of schemas)
            for (const builder of tableDDL(this.kysely, schema, { dialect: this.dialect, ifNotExists: true })) {
                const compiled = builder.compile()
                await this.executor.run(compiled.sql, [...compiled.parameters])
            }
        const applied = await this.executor.all(`SELECT upto_millis, upto_counter FROM _nexus_checkpoints WHERE status = 'applied' ORDER BY upto_millis DESC, upto_counter DESC LIMIT 1`)
        if (applied.length) this.checkpointUpto = { millis: applied[0].upto_millis, counter: applied[0].upto_counter }
        if (this.penGate && this.schemas.size) {
            const { compileEntityPolicy } = await import("./PenPolicy.js")
            this.penBytecode = (await compileEntityPolicy({ site: this.site, entities: [...this.schemas.keys()] })).bytecode
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

        // Gate 3 (§5): ZEN's PEN VM rejects a structurally-invalid write at the
        // graph layer — a malformed soul or an unknown entity never enters the
        // log. Rejected (not quarantined): a plain relay would drop it too.
        if (this.penBytecode) {
            const soul = logSoul(event.site, event.entity, event.id)
            if (!(await authorizeWrite(this.penBytecode, soul)))
                return { status: "rejected", reason: `E_PEN: soul "${soul}" fails the graph write policy` }
        }

        const seen = await this.executor.all(`SELECT id FROM _nexus_events WHERE id = ?`, [event.id])
        if (seen.length) return { status: "duplicate" }

        // Below the checkpoint horizon (§8): the event's HLC is ≤ a pruned
        // upto. If the snapshot already covers it, it is a re-delivered event
        // whose effect is in the base — a harmless duplicate. Otherwise it is
        // genuinely new history arriving after we compacted: a conflict we
        // surface (quarantine), never silently swallow.
        if (this.checkpointUpto && hlcLeq(event.ts, this.checkpointUpto)) {
            const covered = await this.executor.all(`SELECT 1 FROM _nexus_checkpoint_covered WHERE event_id = ?`, [event.id])
            if (covered.length) return { status: "duplicate" }
            await this.executor.run(`INSERT OR REPLACE INTO _nexus_quarantine (id, reason, payload) VALUES (?, ?, ?)`, [
                event.id, "E_HISTORICAL", JSON.stringify(event)
            ])
            return { status: "quarantined", reason: "E_HISTORICAL: event predates a pruned checkpoint" }
        }

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

    /**
     * Fold a row's events (sorted) onto a base image — pure and total. The
     * base is the checkpoint's folded state at the horizon (§8) or null; either
     * way the result depends only on the event SET plus that base, never on
     * arrival order (confluence by construction, §4.2).
     */
    #foldEvents(schema, events, base = null) {
        let state = base ? { ...base } : null
        for (const event of events) {
            const data = this.#upgrade(event)
            if (event.op === "create") {
                state = { id: event.rowId, owner: event.author, created_at: iso(event.ts), updated_at: iso(event.ts) }
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
        return state
    }

    /** The folded base a checkpoint left for this row, or null (§8). */
    async #baseState(entity, rowId) {
        if (!this.checkpointUpto) return null
        const rows = await this.executor.all(`SELECT state FROM _nexus_checkpoint_base WHERE entity = ? AND row_id = ?`, [entity, rowId])
        return rows.length ? JSON.parse(rows[0].state) : null
    }

    /** §4.2 — gather, sort, fold from the checkpoint base: confluence by construction. */
    async #refold(entity, rowId) {
        const schema = this.schemas.get(entity)
        const rows = await this.executor.all(`SELECT payload FROM _nexus_events WHERE entity = ? AND row_id = ?`, [entity, rowId])
        const events = rows.map((r) => JSON.parse(r.payload)).sort(compareEvents)
        const state = this.#foldEvents(schema, events, await this.#baseState(entity, rowId))

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

    // ─── checkpoint & compaction (§8) ─────────────────────────────────────────

    /**
     * The folded state of every row at an HLC horizon, and the set of event
     * ids that horizon covers — the raw material of a checkpoint/snapshot.
     * Folds the current checkpoint base plus every event ≤ upto, so it is
     * correct even after earlier compaction. Deterministically ordered.
     */
    async stateAt(upto) {
        const states = []
        const coveredIds = []
        for (const [entity, schema] of this.schemas) {
            const baseRows = await this.executor.all(`SELECT row_id, state FROM _nexus_checkpoint_base WHERE entity = ?`, [entity])
            const baseMap = new Map(baseRows.map((r) => [r.row_id, JSON.parse(r.state)]))
            const eventRows = await this.executor.all(
                `SELECT id, row_id, payload FROM _nexus_events WHERE entity = ? AND (millis < ? OR (millis = ? AND counter <= ?))`,
                [entity, upto.millis, upto.millis, upto.counter]
            )
            const byRow = new Map()
            for (const r of eventRows) {
                if (!byRow.has(r.row_id)) byRow.set(r.row_id, [])
                byRow.get(r.row_id).push(JSON.parse(r.payload))
                coveredIds.push(r.id)
            }
            for (const rowId of new Set([...baseMap.keys(), ...byRow.keys()])) {
                const events = (byRow.get(rowId) ?? []).sort(compareEvents)
                const state = this.#foldEvents(schema, events, baseMap.get(rowId) ?? null)
                if (state !== null) states.push({ entity, rowId, state })
            }
        }
        for (const r of await this.executor.all(`SELECT event_id FROM _nexus_checkpoint_covered`)) coveredIds.push(r.event_id)
        states.sort((a, b) => (a.entity < b.entity ? -1 : a.entity > b.entity ? 1 : a.rowId < b.rowId ? -1 : a.rowId > b.rowId ? 1 : 0))
        return { states, coveredIds: [...new Set(coveredIds)].sort() }
    }

    /** The state root at a horizon — what a checkpoint commits to (§8). */
    async stateRoot(upto) {
        return stateRootOf((await this.stateAt(upto)).states)
    }

    /** Content address of a snapshot blob (the checkpoint's snapshotRef). */
    static snapshotRef(snapshot) {
        return contentId(stableStringify({
            snapshotVersion: snapshot.snapshotVersion,
            site: snapshot.site,
            upto: snapshot.upto,
            states: snapshot.states,
            coveredIds: snapshot.coveredIds
        }))
    }

    /**
     * ARBITER ROLE: build and sign a checkpoint at `upto`, plus its snapshot
     * blob. Only the arbiter/archive key does this (§8). The snapshot blob is
     * distributed over the file P2P layer (Torrent/RTC) out of band; here it is
     * returned so a caller can store/ship it.
     */
    async createCheckpoint(upto, arbiterPair) {
        const { states, coveredIds } = await this.stateAt(upto)
        const snapshot = { snapshotVersion: 1, site: this.site, upto, states, coveredIds }
        const snapshotRef = SyncEngine.snapshotRef(snapshot)
        const checkpoint = { checkpointVersion: 1, site: this.site, upto, stateRoot: stateRootOf(states), snapshotRef }
        checkpoint.sig = await ZEN.sign(stableStringify(checkpoint), arbiterPair)
        return { checkpoint, snapshot }
    }

    /** Gate: the checkpoint is signed by THIS site's configured arbiter (§8). */
    async verifyCheckpoint(checkpoint) {
        if (checkpoint?.checkpointVersion !== 1) return false
        if (!this.arbiter) return false // no configured arbiter → trust nothing
        const { sig, ...rest } = checkpoint
        try {
            const message = await ZEN.verify(sig, this.arbiter)
            if (message === false || message === null || message === undefined) return false
            const restored = typeof message === "string" ? message : stableStringify(message)
            return restored === stableStringify(rest)
        } catch {
            return false
        }
    }

    /**
     * Receive a checkpoint (§8): refold locally to `upto`, compare state roots.
     * Match → prune events ≤ upto (their effect lives on in the base). Mismatch
     * → red alert, NEVER prune (the logs disagree; doctor surfaces it). No
     * configured arbiter → never prune. Returns what happened.
     */
    async applyCheckpoint(checkpoint) {
        if (!this.arbiter) return { status: "no-arbiter" }
        if (!(await this.verifyCheckpoint(checkpoint))) return { status: "rejected", reason: "E_CHECKPOINT_SIG" }
        const { states, coveredIds } = await this.stateAt(checkpoint.upto)
        const localRoot = stateRootOf(states)
        if (localRoot !== checkpoint.stateRoot) {
            await this.#recordCheckpoint(checkpoint, "divergent")
            return { status: "divergent", localRoot, checkpointRoot: checkpoint.stateRoot }
        }
        const pruned = await this.#prune(checkpoint, states, coveredIds)
        return { status: "pruned", pruned }
    }

    /**
     * Bootstrap a fresh peer from a checkpoint + snapshot (§9): verify the
     * arbiter's signature, the snapshot's content address, and its state root,
     * then load the rows straight into SQL. No log replay needed.
     */
    async bootstrapFromCheckpoint(checkpoint, snapshot) {
        if (!(await this.verifyCheckpoint(checkpoint))) return { status: "rejected", reason: "E_CHECKPOINT_SIG" }
        if (SyncEngine.snapshotRef(snapshot) !== checkpoint.snapshotRef) return { status: "rejected", reason: "E_SNAPSHOT_REF" }
        if (stateRootOf(snapshot.states) !== checkpoint.stateRoot) return { status: "rejected", reason: "E_STATE_ROOT" }
        for (const s of snapshot.states) {
            await this.executor.run(`INSERT OR REPLACE INTO _nexus_checkpoint_base (entity, row_id, state) VALUES (?, ?, ?)`, [s.entity, s.rowId, JSON.stringify(s.state)])
            await this.executor.run(`DELETE FROM "${s.entity}" WHERE id = ?`, [s.rowId])
            const values = Object.fromEntries(Object.entries(s.state).map(([k, v]) => [k, v === true ? 1 : v === false ? 0 : v ?? null]))
            const compiled = this.kysely.insertInto(s.entity).values(values).compile()
            await this.executor.run(compiled.sql, [...compiled.parameters])
        }
        for (const id of snapshot.coveredIds) await this.executor.run(`INSERT OR IGNORE INTO _nexus_checkpoint_covered (event_id) VALUES (?)`, [id])
        this.checkpointUpto = checkpoint.upto
        await this.#recordCheckpoint(checkpoint, "applied")
        return { status: "bootstrapped", rows: snapshot.states.length }
    }

    async #prune(checkpoint, states, coveredIds) {
        for (const s of states) await this.executor.run(`INSERT OR REPLACE INTO _nexus_checkpoint_base (entity, row_id, state) VALUES (?, ?, ?)`, [s.entity, s.rowId, JSON.stringify(s.state)])
        for (const id of coveredIds) await this.executor.run(`INSERT OR IGNORE INTO _nexus_checkpoint_covered (event_id) VALUES (?)`, [id])
        const before = (await this.executor.all(`SELECT COUNT(*) AS n FROM _nexus_events`))[0].n
        await this.executor.run(`DELETE FROM _nexus_events WHERE millis < ? OR (millis = ? AND counter <= ?)`, [checkpoint.upto.millis, checkpoint.upto.millis, checkpoint.upto.counter])
        const after = (await this.executor.all(`SELECT COUNT(*) AS n FROM _nexus_events`))[0].n
        this.checkpointUpto = checkpoint.upto
        await this.#recordCheckpoint(checkpoint, "applied")
        return before - after
    }

    async #recordCheckpoint(checkpoint, status) {
        await this.executor.run(
            `INSERT INTO _nexus_checkpoints (upto_millis, upto_counter, state_root, snapshot_ref, payload, status) VALUES (?, ?, ?, ?, ?, ?)`,
            [checkpoint.upto.millis, checkpoint.upto.counter, checkpoint.stateRoot, checkpoint.snapshotRef, JSON.stringify(checkpoint), status]
        )
    }
}

const iso = (ts) => new Date(ts.millis).toISOString()

export default { EVENT_VERSION, canonical, contentId, createEvent, verifyEvent, HLC, compareEvents, hlcLeq, merkleRoot, stateRootOf, SyncEngine }
