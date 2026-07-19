/**
 * The effect engine core (design 2026-07-19): claim/ack/retry/DLQ over
 * ordinary nexus_job rows. Only what cannot live above (N5) is here — the
 * CLAIM is the one adapter-level primitive (token-CAS UPDATE: portable, no
 * RETURNING, no same-table subselect, exactly one winner per row); every
 * other transition is a plain plane.update so hooks and audit see the
 * lifecycle like any data. Delivery is AT-LEAST-ONCE by design (§6).
 */

import { randomUUID } from "crypto"

export const LEASE_MS = 60000
export const BACKOFF = Object.freeze({ base: 5000, cap: 300000 })

/** Exponential backoff, clause-pinned: min(cap, base·2^attempts). */
export const backoffMs = (attempts) => Math.min(BACKOFF.cap, BACKOFF.base * 2 ** attempts)

const iso = (ms) => new Date(ms).toISOString()

/**
 * Create a pending nexus_job row — the ONLY way work enters the engine.
 * Defaults run_at to right now BY THE PLANE'S OWN CLOCK (never wall-clock
 * Date.now()) — the whole engine rides one injectable now(), so a test
 * clock frozen at some arbitrary instant still makes freshly-enqueued work
 * immediately due.
 */
export async function enqueue(plane, ctx, name, payload = {}, { runAt, everyMs, maxAttempts } = {}) {
    return plane.create("nexus_job", {
        name,
        payload: JSON.stringify(payload ?? {}),
        status: "pending",
        run_at: runAt ?? iso(plane.now()),
        every_ms: everyMs ?? null,
        attempts: 0,
        max_attempts: maxAttempts ?? 5
    }, ctx)
}

/**
 * Claim the next due job. Token-CAS: pick a candidate, stamp it with a
 * fresh token IN ONE GUARDED UPDATE, then read the token back — if our
 * token stuck, the row is ours. Works on every dialect; two racers on the
 * same row see exactly one winner (the UPDATE's WHERE re-checks the guards).
 *
 * The claim also increments `attempts` — the row it returns already carries
 * the POST-increment count, so a first failure downstream sees attempts=1
 * and schedules backoffMs(1), and `dead` fires the moment the just-failed
 * attempt count reaches max_attempts (JOB-04/05).
 */
export async function claimNext(plane, { now }) {
    const t = iso(now())
    // claimable: due pending/failed rows, AND running rows whose lease expired
    // (crash recovery — a dead thread's job must never stay stuck in running)
    const DUE = `run_at <= ? AND (status IN ('pending','failed') AND (lease_until IS NULL OR lease_until < ?) OR status = 'running' AND lease_until < ?)`
    const candidates = await plane.executor.all(
        `SELECT id FROM nexus_job WHERE ${DUE} ORDER BY run_at LIMIT 1`,
        [t, t, t]
    )
    if (!candidates.length) return null
    const id = candidates[0].id
    const token = randomUUID()
    await plane.executor.run(
        `UPDATE nexus_job SET status = 'running', attempts = attempts + 1, lease_until = ?, lease_token = ? WHERE id = ? AND ${DUE}`,
        [iso(now() + LEASE_MS), token, id, t, t, t]
    )
    const rows = await plane.executor.all(`SELECT * FROM nexus_job WHERE id = ? AND lease_token = ?`, [id, token])
    return rows[0] ?? null // token didn't stick → someone else won
}

/**
 * One full lifecycle turn: claim → vet → execute → settle. Returns true if
 * a job was processed. `jobs` is the handler registry (Map name → spec);
 * `execute({ id, name, payload })` runs the handler (Task 4 puts it in a
 * thread); `ctx` is the engine's job context for the settle updates.
 */
export async function runnerTick(plane, { now, jobs, execute, ctx, log = console } = {}) {
    const row = await claimNext(plane, { now })
    if (!row) return false
    const settle = (patch) => plane.update("nexus_job", row.id, { ...patch, lease_until: null, lease_token: null }, ctx)

    let payload
    try {
        payload = row.payload ? JSON.parse(row.payload) : {}
    } catch {
        await settle({ status: "dead", last_error: "E_PAYLOAD: payload is not JSON" }) // fail LOUD — a lost job is lost work
        return true
    }
    if (!jobs.has(row.name)) {
        await settle({ status: "dead", last_error: `E_HANDLER: no handler registered for "${row.name}"` })
        return true
    }

    try {
        const result = await execute({ id: row.id, name: row.name, payload })
        if (row.every_ms) await settle({ status: "pending", attempts: 0, run_at: iso(now() + row.every_ms), result: JSON.stringify(result ?? null) })
        else await settle({ status: "done", result: JSON.stringify(result ?? null) })
    } catch (error) {
        const message = String(error?.message ?? error)
        // row.attempts is the POST-increment count the claim already stamped —
        // the just-failed attempt IS row.attempts (JOB-04: first failure → backoffMs(1)).
        if (row.attempts >= row.max_attempts) await settle({ status: "dead", last_error: message })
        else await settle({ status: "failed", last_error: message, run_at: iso(now() + backoffMs(row.attempts)) })
        log.warn?.(`nexus_job ${row.id} (${row.name}) attempt ${row.attempts}: ${message}`)
    }
    return true
}

export default { LEASE_MS, BACKOFF, backoffMs, enqueue, claimNext, runnerTick }
