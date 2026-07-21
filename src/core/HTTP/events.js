/**
 * The realtime event hub (design 2026-07-20 §1): SSE subscribers fed from
 * the entity after-hooks. THE RULE: permission never leaves the plane — an
 * event reaches a subscriber only if that subscriber could see the row.
 * For create/update that means re-reading it through the Data Plane; for
 * remove the row is gone, so the plane hands over the pre-image it captured
 * and the row rule is evaluated against that (I11) — it used to settle for a
 * document-level answer, which leaked every deleted id past every row-level
 * restriction. No row data ever rides the stream: the pre-image DECIDES, it
 * is never SENT. Failures are contained twice over: a hook failure never
 * fails the write (WH-03 doctrine), and one broken subscriber never starves
 * the rest.
 */

import Permission from "../Permission.js"
import * as AST from "../AST.js"

const DEFAULT_EXCLUDED = ["nexus_job"] // lifecycle churn — opt in via ?entities=

/**
 * The authorization inputs `visible()` actually depends on. Two subscribers
 * with the same fingerprint MUST get the same answer for the same event, so
 * one query can serve both (EVT-FANOUT-01).
 *
 * `user` is in here for a reason worth stating: `$CURRENT_USER` and `ifOwner`
 * make an identical policy set mean different things for different people, so
 * a fingerprint over policies alone would let one tenant's row be announced to
 * another (EVT-FANOUT-02).
 */
const authFingerprint = (ctx = {}) =>
    JSON.stringify([ctx.user ?? null, ctx.roles ?? [], ctx.policies ?? [], ctx.shares ?? []])

export function createEventHub({ plane, heartbeatMs = 30000, maxSubscribers = 1000 } = {}) {
    const subscribers = new Set()

    const reap = (sub) => {
        subscribers.delete(sub)
        try { sub.res.end() } catch { /* already gone */ }
    }

    const heartbeat = heartbeatMs > 0
        ? setInterval(() => {
            for (const sub of [...subscribers]) {
                try { sub.res.write(":hb\n\n") } catch { reap(sub) }
            }
        }, heartbeatMs)
        : null

    /**
     * May THIS subscriber see THIS event? The plane decides. This function
     * must NEVER throw — a denial, a missing row, or a broken policy rule
     * (e.g. one referencing $NOW with no context) all resolve to `false`.
     * emit()'s own try/catch exists solely to catch a broken pipe on
     * `res.write` and reap the subscriber; a policy-evaluation failure here
     * must never reach that catch and be mistaken for a dead connection.
     */
    async function visible(sub, { entity, event, id, row }) {
        try {
            if (sub.entities ? !sub.entities.includes(entity) : DEFAULT_EXCLUDED.includes(entity)) return false
            if (event === "remove") {
                // The row is gone, so it cannot be re-read — but `remove` now
                // arrives with the pre-image the Data Plane captured, and the
                // row rule is evaluated against THAT (I11). Stopping at
                // `.allowed`, as this used to, discards the `rule`/`ifOwner`
                // that survive only in `filter`; `.allowed` is true for anyone
                // holding any permlevel-0 read policy on the entity, so every
                // deleted row's id crossed every row-level restriction — a
                // cross-tenant identifier feed on a multi-tenant instance.
                //
                // No pre-image means no way to prove visibility, and unable to
                // prove is not permission to send (EVT-ROWGATE-04).
                if (!row) return false
                const { allowed, filter } = Permission.resolve(sub.ctx.policies ?? [], {
                    entity, action: "read", user: sub.ctx.user, roles: sub.ctx.roles ?? [], now: plane.now()
                })
                return allowed && (filter === null || AST.predicate(filter)(row))
            }
            return (await plane.get(entity, id, sub.ctx)) != null
        } catch {
            return false // denied, unreadable, or a policy-evaluation error — the subscriber learns nothing, the connection survives
        }
    }

    return {
        /**
         * @returns {Function|null} an unsubscribe fn, or null when the hub is
         *   at `maxSubscribers`. An open SSE connection is a held socket plus a
         *   share of every write's cost; unbounded is not a position. The
         *   caller answers 503 — refusing a new connection must never disturb
         *   the ones already established (EVT-CAP-01).
         */
        subscribe({ res, ctx, entities = null }) {
            if (subscribers.size >= maxSubscribers) return null
            try {
                res.writeHead?.(200, {
                    "content-type": "text/event-stream",
                    "cache-control": "no-cache",
                    "connection": "keep-alive"
                })
            } catch {}
            try {
                res.write(":connected\n\n")
            } catch {}
            const sub = { res, ctx, entities }
            subscribers.add(sub)
            const off = () => reap(sub)
            try {
                res.on?.("close", off)
                res.on?.("error", off)
            } catch {}
            return off
        },

        async emit({ entity, event, id, row = null }) {
            const ts = Date.now()
            const toDelete = []
            // One answer per distinct authorization context, not per subscriber
            // (EVT-FANOUT-01). visible() is a pure function of the event plus
            // these inputs, and this event is fixed for the whole loop — so a
            // thousand subscribers across five contexts cost five reads, not a
            // thousand. Parallelising instead would merely turn a thousand
            // serial queries into a thousand concurrent ones.
            //
            // The memo is created HERE and discarded when this call returns:
            // scoped to one emit, so there is no staleness window and nothing
            // to invalidate (EVT-FANOUT-03).
            const decided = new Map()
            for (const sub of [...subscribers]) {
                // visible() never throws — a policy-evaluation failure denies the
                // event, it never lands here and is never mistaken for a broken pipe.
                // `row` is the removal pre-image: it DECIDES, and is never sent.
                const key = `${sub.entities ? sub.entities.join(",") : "*"}\u0000${authFingerprint(sub.ctx)}`
                if (!decided.has(key)) decided.set(key, await visible(sub, { entity, event, id, row }))
                if (!decided.get(key)) continue
                try {
                    sub.res.write(`data:${JSON.stringify({ entity, event, id, ts })}\n\n`)
                } catch (err) {
                    toDelete.push(sub) // broken pipe — this, and only this, means reap
                }
            }
            for (const sub of toDelete) reap(sub)
        },

        /**
         * Guarded after-hooks: fire-and-forget. The hook fn itself is NOT
         * async and never awaits emit() — Extensions.run awaits whatever the
         * hook returns, so an async hook here would make every write wait on
         * the full subscriber fan-out. Arrow functions keep `this` bound to
         * the hub (attach() is called as hub.attach(...)) without needing to
         * hoist emit into a separate named function.
         */
        attach(extensions, schemas = []) {
            const fire = (entity, event) => (payload) => {
                const id = payload.row?.id ?? payload.id
                // For a removal this is the captured pre-image, carried only so
                // visible() can evaluate the row rule against it (I11). It
                // never reaches the wire — the frame stays {entity,event,id,ts}.
                const row = payload.row ?? null
                try {
                    this.emit({ entity, event, id, row }).catch(() => {
                        // fire-and-forget: an async rejection never fails the write
                    })
                } catch {
                    // fire-and-forget: a synchronously-throwing emit never fails the write either
                }
            }
            for (const s of schemas)
                for (const [hookEvent, short] of [["after:create", "create"], ["after:update", "update"], ["after:remove", "remove"]])
                    extensions.hook(s.name, hookEvent, fire(s.name, short))
        },

        stop() {
            if (heartbeat) clearInterval(heartbeat)
            for (const sub of [...subscribers]) reap(sub)
        },

        size: () => subscribers.size
    }
}

export default { createEventHub }
