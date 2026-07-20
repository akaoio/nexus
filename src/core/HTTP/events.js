/**
 * The realtime event hub (design 2026-07-20 §1): SSE subscribers fed from
 * the entity after-hooks. THE RULE: permission never leaves the plane — an
 * event reaches a subscriber only if that subscriber can re-read the row
 * through the Data Plane (removes fall back to the doc-level resolve; the
 * row is gone). No row data ever rides the stream. Failures are contained
 * twice over: a hook failure never fails the write (WH-03 doctrine), and
 * one broken subscriber never starves the rest.
 */

import Permission from "../Permission.js"

const DEFAULT_EXCLUDED = ["nexus_job"] // lifecycle churn — opt in via ?entities=

export function createEventHub({ plane, heartbeatMs = 30000 } = {}) {
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
    async function visible(sub, { entity, event, id }) {
        try {
            if (sub.entities ? !sub.entities.includes(entity) : DEFAULT_EXCLUDED.includes(entity)) return false
            if (event === "remove")
                return Permission.resolve(sub.ctx.policies ?? [], {
                    entity, action: "read", user: sub.ctx.user, roles: sub.ctx.roles ?? [], now: plane.now()
                }).allowed
            return (await plane.get(entity, id, sub.ctx)) != null
        } catch {
            return false // denied, unreadable, or a policy-evaluation error — the subscriber learns nothing, the connection survives
        }
    }

    return {
        subscribe({ res, ctx, entities = null }) {
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

        async emit({ entity, event, id }) {
            const ts = Date.now()
            const toDelete = []
            for (const sub of [...subscribers]) {
                // visible() never throws — a policy-evaluation failure denies the
                // event, it never lands here and is never mistaken for a broken pipe.
                if (!(await visible(sub, { entity, event, id }))) continue
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
                try {
                    this.emit({ entity, event, id }).catch(() => {
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
