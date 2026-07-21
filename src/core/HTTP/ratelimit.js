/**
 * Token-bucket rate limiting (RATE-*) — issue #9's "no rate limiting anywhere".
 *
 * The security chunk's body-size and challenge-map caps bound memory PER
 * REQUEST. Nothing bounded the request RATE: `/_auth/challenge`,
 * `/_auth/verify` and every `/api/v1/*` route accepted work as fast as a client
 * could open connections, and each pre-auth call costs a signature check.
 *
 * Pure and clock-injected — no Node imports, no timers, no globals. It decides;
 * the servers act on the decision.
 *
 * TWO PROPERTIES MATTER MORE THAN THE LIMITING ITSELF:
 *
 *  1. **The key map is bounded.** A per-IP bucket map with no cap has exactly
 *     the bug I3 found in the challenge map, one level up: an attacker with
 *     many source addresses grows it without limit, so the anti-DoS measure
 *     becomes the DoS. Idle buckets are swept and the map is hard-capped.
 *
 *  2. **It fails CLOSED.** When the map is full, a key that cannot be given a
 *     bucket is held to the TIGHTEST configured tier — never waved through.
 *     A limiter that falls back to unlimited under pressure hands an attacker
 *     the switch that turns it off, which is worse than having none, because
 *     the operator believes they are protected.
 *
 * HONEST BLAST RADIUS: the bucket is per PROCESS and per KEY, in memory. Two
 * processes behind a load balancer allow twice the configured rate, and a
 * restart forgets everything. This is a real bound against one noisy client and
 * it is NOT a defence against a distributed flood — that belongs at the proxy
 * or the network. Stated here and in STATUS rather than implied.
 */

/**
 * Default tiers. Pre-auth is strictly tighter than authenticated traffic
 * (RATE-02): anyone can reach it without a credential and every call costs a
 * signature verification, whereas authenticated traffic is attributable.
 *
 * Chosen to be invisible in normal use — a Studio session issues bursts of
 * reads on navigation, and a limiter a human trips by clicking is a bug.
 */
export const TIERS = Object.freeze({
    /** Unauthenticated: /_auth/challenge, /_auth/verify. */
    auth: Object.freeze({ burst: 20, perMs: 3000 }),
    /** Everything else, incl. authenticated /api/v1/*. */
    api: Object.freeze({ burst: 240, perMs: 250 })
})

const tightestOf = (tiers) =>
    Object.values(tiers).reduce((a, b) => (a.burst <= b.burst ? a : b))

/**
 * @param {Object} [options]
 * @param {Object} [options.tiers] - { name: { burst, perMs } }; perMs = ms per token refilled
 * @param {number} [options.maxKeys=10000] - hard cap on tracked keys
 * @param {number} [options.idleMs=600000] - a bucket untouched for this long is reclaimable
 * @param {Function} [options.now] - injected clock (ms)
 */
export function createLimiter({ tiers = TIERS, maxKeys = 10_000, idleMs = 600_000, now = Date.now } = {}) {
    // Bucket per (tier, key), NOT per key. Sharing one bucket across tiers
    // makes the tighter tier's behaviour depend on unrelated traffic: a burst
    // of ordinary API calls drains it, and the next pre-auth request is then
    // refused and refilled at the pre-auth tier's much slower rate. The tiers
    // exist precisely so those two kinds of traffic do not affect each other
    // (RATE-09).
    const buckets = new Map() // "tier\0key" → { tokens, last, seen }
    const tightest = tightestOf(tiers)
    // The fail-closed fallback (RATE-04). Deliberately NOT a member of
    // `buckets`: it is not a tracked key, it is the one bucket everyone shares
    // once there is no room to track them — so it must not count against the
    // very cap it exists to enforce.
    let overflow = null

    /** Reclaim idle buckets. Called only when the map is at its cap, so the
     *  common path costs nothing. */
    const sweep = (t) => {
        for (const [key, bucket] of buckets) if (t - bucket.seen > idleMs) buckets.delete(key)
    }

    const take = (bucket, tier, t) => {
        // Refill by elapsed time, never above the burst ceiling.
        const refill = (t - bucket.last) / tier.perMs
        bucket.tokens = Math.min(tier.burst, bucket.tokens + refill)
        bucket.last = t
        bucket.seen = t
        if (bucket.tokens >= 1) {
            bucket.tokens -= 1
            return { allowed: true, retryAfter: 0 }
        }
        // Tell the caller WHEN, not merely no — a client that knows when to
        // come back stops hammering, which is the point of limiting it.
        return { allowed: false, retryAfter: Math.ceil(((1 - bucket.tokens) * tier.perMs) / 1000) }
    }

    return {
        tightest,

        /**
         * Spend one token for `key` in `tier`.
         * @returns {{allowed: boolean, retryAfter: number}} retryAfter in seconds
         */
        check(key, tierName = "api") {
            const tier = tiers[tierName] ?? tightest
            const t = now()
            const slot = `${tierName}\u0000${key}`
            let bucket = buckets.get(slot)

            if (!bucket) {
                if (buckets.size >= maxKeys) sweep(t)
                if (buckets.size >= maxKeys) {
                    // No room. Hold the stranger to the tightest tier rather
                    // than admitting it — failing closed (RATE-04). One shared
                    // bucket for everyone in this state, which is the intended
                    // pressure: an address flood throttles itself.
                    if (!overflow) overflow = { tokens: tightest.burst, last: t, seen: t }
                    return take(overflow, tightest, t)
                }
                bucket = { tokens: tier.burst, last: t, seen: t }
                buckets.set(slot, bucket)
            }
            return take(bucket, tier, t)
        },

        size: () => buckets.size
    }
}

/**
 * Which tier a path belongs to. Pre-auth routes are the ones reachable without
 * a credential — declared here, once, so both servers agree.
 */
export const tierFor = (pathname) => (/(^|\/)_auth\//.test(pathname) ? "auth" : "api")

/**
 * The key a request is limited under.
 *
 * `X-Forwarded-For` is IGNORED unless the deployment says it sits behind a
 * proxy (RATE-05). It is a header the CALLER controls: honouring it by default
 * would let anyone mint a fresh bucket per request and turn the limiter into a
 * no-op — the failure mode where an operator believes they are protected and
 * is not. When `trustProxy` IS set the left-most entry is taken, which is the
 * client the proxy actually saw.
 *
 * @param {{socket?: {remoteAddress?: string}, headers?: Object}} req
 * @param {{trustProxy?: boolean}} [options]
 */
export function clientKey(req, { trustProxy = false } = {}) {
    if (trustProxy) {
        const forwarded = req.headers?.["x-forwarded-for"]
        if (typeof forwarded === "string" && forwarded.trim()) return forwarded.split(",")[0].trim()
    }
    return req.socket?.remoteAddress ?? "unknown"
}

/**
 * Build the limiter a server should use from its instance config, or `null`
 * when the operator turned it off (`limits.enabled: false`).
 *
 * Off is a real, supported choice — an instance behind a proxy that already
 * limits does not need a second limiter — so it is a config value rather than
 * something to be achieved by setting the numbers absurdly high.
 */
export function limiterFor(config = {}) {
    const limits = config.limits ?? {}
    if (limits.enabled === false) return null
    return createLimiter({
        tiers: {
            auth: { ...TIERS.auth, ...(limits.auth ?? {}) },
            api: { ...TIERS.api, ...(limits.api ?? {}) }
        },
        maxKeys: limits.max_keys ?? 10_000,
        idleMs: limits.idle_ms ?? 600_000
    })
}

export default { createLimiter, TIERS, tierFor, clientKey, limiterFor }
