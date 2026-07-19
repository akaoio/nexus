/**
 * The EFFECT APP (design §5) — nexus's first consumers, written against the
 * registrar surface every third-party app gets (§361 applied twice): if this
 * file can build webhooks with public surface, any app can build any effect.
 * Loaded twice by design: on MAIN (hooks + registry) and inside the job
 * THREAD (handlers only — plane arrives as the narrow RPC).
 */

import { createHmac } from "crypto"
import { mailProvider } from "./mailer.js"

/** HMAC-SHA256 hex over the canonical JSON body — receivers verify with the row's secret. */
export function sign(secret, body) {
    return createHmac("sha256", String(secret ?? "")).update(JSON.stringify(body)).digest("hex")
}

const EVENTS = ["after:create", "after:update", "after:remove"]

export default function effects(registrar, { schemas = [], plane = null, ctx = null, config = {}, root = process.cwd() } = {}) {
    // ── consumers (run in the job thread; harmless to register on main too)
    registrar.job("effects.webhook", {
        run: async ({ id, payload }) => {
            const res = await fetch(payload.url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-nexus-signature": sign(payload.secret, payload.body),
                    "x-nexus-delivery": String(id)
                },
                body: JSON.stringify(payload.body)
            })
            if (!res.ok) throw new Error(`E_WEBHOOK: receiver answered ${res.status}`)
            return { status: res.status }
        }
    })
    registrar.job("effects.notify", {
        run: async ({ payload }, { plane: rpc }) => rpc.create("nexus_notification", { user: payload.user, title: payload.title, body: payload.body ?? null, href: payload.href ?? null, read: false })
    })
    registrar.job("effects.mail", {
        run: async ({ payload }) => mailProvider(config, root).send(payload)
    })

    // ── emitters (main only: they need the real plane to read subscriptions)
    if (!plane) return
    const fire = (entity, event) => async (payload) => {
        try {
            const hooks = await plane.list("nexus_webhook", {}, ctx)
            const id = payload.row?.id ?? payload.id
            for (const row of hooks) {
                if (!row.enabled) continue
                if (row.entity && row.entity !== entity) continue
                let events = null
                try {
                    events = row.events ? JSON.parse(row.events) : null
                } catch (error) {
                    console.warn(`effects: nexus_webhook row ${row.id} has malformed events — ${String(error?.message ?? error)}`)
                    continue
                }
                if (events?.length && !events.includes(event)) continue
                await registrar.enqueue("effects.webhook", { url: row.url, secret: row.secret, body: { entity, event, id, ts: Date.now() } })
            }
        } catch (error) {
            console.warn(`effects: webhook emit failed for ${entity} ${event} — ${String(error?.message ?? error)}`)
        }
    }
    for (const s of schemas) {
        if (s.name === "nexus_job") continue // effects on the effect ledger = feedback loop
        for (const event of EVENTS) registrar.hook(s.name, event, fire(s.name, event))
    }
}
