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

/**
 * A webhook row must target http(s) — anything else is an SSRF vector
 * (issue #9 I1): file://, a bare path, or any other scheme would hand the
 * row's author a server-side fetch of whatever they like (cloud metadata,
 * an internal port), with the response status readable back via
 * nexus_job.result. Pure and exported so it gates BOTH the write (server.js
 * before:create/update hook) and dispatch (the handler, re-checked in case
 * the row changed between enqueue and run).
 *
 * `config.webhooks.allow_hosts` is an optional additional narrowing — an
 * allowlist of hostnames. Left unset (the default), it is permissive: any
 * http(s) host is accepted, so existing setups are unaffected.
 */
export function validateWebhookRow(data = {}, config = {}) {
    let parsed
    try { parsed = new URL(String(data.url ?? "")) } catch { return { valid: false, errors: [{ code: "E_URL" }] } }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { valid: false, errors: [{ code: "E_SCHEME" }] }
    // NOT a hard boundary: this matches on `parsed.hostname`, a STRING, never
    // a resolved address — an allowed hostname that later resolves to an
    // internal IP (DNS rebinding, or just a CNAME repointed after the row was
    // written) sails straight through. Nor does the http(s)-only check above
    // stop SSRF: 169.254.169.254 and localhost are perfectly valid http(s)
    // hosts. Neither mechanism is an SSRF boundary by itself — allow_hosts is
    // a narrowing knob for cooperative deployments, not a sandbox.
    const allowHosts = config.webhooks?.allow_hosts
    if (Array.isArray(allowHosts) && allowHosts.length && !allowHosts.includes(parsed.hostname)) return { valid: false, errors: [{ code: "E_HOST" }] }
    return { valid: true }
}

const EVENTS = ["after:create", "after:update", "after:remove"]

export default function effects(registrar, { schemas = [], plane = null, ctx = null, config = {}, root = process.cwd() } = {}) {
    // ── consumers (run in the job thread; harmless to register on main too)
    registrar.job("effects.webhook", {
        run: async ({ id, payload }, { plane: rpc }) => {
            // the secret never rode in the payload (issue #9 I10) — resolve the
            // row (and its secret) fresh, through the narrow plane-RPC, at fire time
            const row = await rpc.get("nexus_webhook", payload.webhookId)
            if (!row) throw new Error("E_WEBHOOK: subscription is gone")
            if (!validateWebhookRow(row, config).valid) throw new Error("E_WEBHOOK: subscription URL is not http(s)")
            const res = await fetch(row.url, {
                method: "POST",
                redirect: "manual", // a redirect is a failure, not a silent hop (issue #9 I1)
                signal: AbortSignal.timeout(config.webhooks?.timeout_ms ?? 10000),
                headers: {
                    "content-type": "application/json",
                    "x-nexus-signature": sign(row.secret, payload.body),
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
                // enqueue the id, never the secret (issue #9 I10) — nexus_job.payload
                // is Studio-rendered and admin-exposed; the HMAC secret must not sit there
                await registrar.enqueue("effects.webhook", { webhookId: row.id, body: { entity, event, id, ts: Date.now() } })
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
