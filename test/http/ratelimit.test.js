/**
 * Request rate limiting (RATE-*) — issue #9's "no rate limiting anywhere"
 * moderate.
 *
 * The body-size and challenge-map caps from the security chunk bound memory
 * PER REQUEST. Nothing bounded the request RATE: `/_auth/challenge`,
 * `/_auth/verify` and every `/api/v1/*` route accepted work as fast as a
 * client could open connections, and each pre-auth call costs a signature
 * verification.
 *
 * RATE-03 and RATE-04 are the clauses that matter most here, and neither is
 * about limiting. A per-key bucket map with no cap has exactly the bug I3
 * found in the challenge map, one level up — an attacker with many source
 * addresses grows it without bound, so the anti-DoS measure becomes the DoS.
 * And a limiter that runs out of room must fail CLOSED; one that falls back to
 * unlimited hands an attacker the switch that turns it off.
 */

import Test, { assert } from "../../src/core/Test.js"
import { createLimiter, TIERS, tierFor, clientKey, limiterFor } from "../../src/core/HTTP/ratelimit.js"

/** A clock the test drives, so refill is asserted rather than waited for. */
const clock = (start = 0) => {
    let t = start
    return { now: () => t, advance: (ms) => { t += ms } }
}

Test.describe("Request rate limiting (RATE)", () => {

    Test.it("RATE-01 a bucket allows its burst, then refuses with a retry hint, and refills over time", () => {
        const c = clock()
        const limiter = createLimiter({ tiers: { api: { burst: 3, perMs: 1000 } }, now: c.now })

        for (let i = 0; i < 3; i++)
            assert.truthy(limiter.check("1.2.3.4", "api").allowed, `burst request ${i + 1} must pass`)

        const refused = limiter.check("1.2.3.4", "api")
        assert.falsy(refused.allowed, "the fourth exceeds the burst")
        assert.truthy(refused.retryAfter > 0, "and the caller is told when to come back, not just refused")

        c.advance(1000) // one token's worth
        assert.truthy(limiter.check("1.2.3.4", "api").allowed, "the bucket refills")

        // A different caller is unaffected — the limit is per key, not global.
        assert.truthy(limiter.check("5.6.7.8", "api").allowed)
    })

    Test.it("RATE-02 the pre-auth tier is strictly tighter than the authenticated one — anyone can reach it, and each call costs a signature check", () => {
        assert.truthy(
            TIERS.auth.burst < TIERS.api.burst,
            `pre-auth burst (${TIERS.auth.burst}) must be tighter than api (${TIERS.api.burst})`
        )
        assert.truthy(TIERS.auth.perMs >= TIERS.api.perMs, "and refill no faster")
    })

    Test.it("RATE-03 the limiter's OWN key map is swept and hard-capped — an unbounded anti-DoS map is the DoS", () => {
        const c = clock()
        const limiter = createLimiter({
            tiers: { api: { burst: 2, perMs: 1000 } },
            maxKeys: 10,
            idleMs: 5000,
            now: c.now
        })

        for (let i = 0; i < 500; i++) limiter.check(`10.0.0.${i}`, "api")
        assert.truthy(limiter.size() <= 10, `the map must stay capped, saw ${limiter.size()}`)

        // And idle keys are reclaimed rather than held forever.
        c.advance(60000)
        limiter.check("192.168.0.1", "api")
        assert.truthy(limiter.size() <= 10)
    })

    Test.it("RATE-04 at the cap an unknown key gets the TIGHTEST tier, never unlimited — the limiter fails closed", () => {
        const c = clock()
        const limiter = createLimiter({
            tiers: { api: { burst: 100, perMs: 10 }, auth: { burst: 2, perMs: 5000 } },
            maxKeys: 1,
            idleMs: 1_000_000, // nothing is idle, so the cap is genuinely full
            now: c.now
        })

        limiter.check("first", "api") // occupies the only slot

        // A second key cannot be given a bucket. It must NOT be waved through:
        // that would hand an attacker the switch that turns the limiter off.
        let allowed = 0
        for (let i = 0; i < 20; i++) if (limiter.check("second", "api").allowed) allowed++

        assert.truthy(allowed <= TIERS_TIGHTEST_BURST(limiter), "an over-cap key is held to the tightest tier")
        assert.truthy(allowed < 20, "and is certainly not unlimited")
    })

    Test.it("RATE-09 the tiers do not share a bucket — ordinary API traffic cannot drain the pre-auth allowance", () => {
        // Found by this chunk's own default tripping the Studio suite. With one
        // bucket per key, a burst of api calls emptied it and the NEXT pre-auth
        // request was refused, then refilled at the pre-auth tier's much slower
        // rate. The tiers exist so those two kinds of traffic do not affect each
        // other; sharing a bucket quietly undoes that.
        const c = clock()
        const limiter = createLimiter({
            tiers: { api: { burst: 5, perMs: 10 }, auth: { burst: 2, perMs: 60000 } },
            now: c.now
        })

        for (let i = 0; i < 5; i++) limiter.check("1.1.1.1", "api")
        assert.falsy(limiter.check("1.1.1.1", "api").allowed, "the api tier is spent")

        assert.truthy(limiter.check("1.1.1.1", "auth").allowed, "the pre-auth allowance must be untouched by it")
        assert.truthy(limiter.check("1.1.1.1", "auth").allowed)
        assert.falsy(limiter.check("1.1.1.1", "auth").allowed, "and still enforced on its own terms")
    })

    Test.it("RATE-05 X-Forwarded-For buys nothing unless the deployment says it is behind a proxy", () => {
        const req = { socket: { remoteAddress: "203.0.113.9" }, headers: { "x-forwarded-for": "9.9.9.9, 8.8.8.8" } }

        // Default: the header is a value the CALLER controls. Honouring it
        // would let anyone mint a fresh bucket per request — a limiter that is
        // off while the operator believes it is on.
        assert.equal(clientKey(req), "203.0.113.9")

        // Opted in: the left-most entry is the client the proxy actually saw.
        assert.equal(clientKey(req, { trustProxy: true }), "9.9.9.9")

        // No socket, no header, no crash.
        assert.equal(clientKey({}), "unknown")
    })

    Test.it("RATE-06 routing: pre-auth paths take the auth tier in both servers, everything else the api tier", () => {
        assert.equal(tierFor("/api/v1/_auth/challenge"), "auth")
        assert.equal(tierFor("/api/v1/_auth/verify"), "auth")
        assert.equal(tierFor("/_auth/challenge"), "auth")
        assert.equal(tierFor("/api/v1/task"), "api")
        assert.equal(tierFor("/_studio/model"), "api")
    })

    Test.it("RATE-10 a Studio boot is not throttled — the api tier once made the page fail to load at all", () => {
        // The regression this exists for: every path that was not /_auth/ took
        // the api tier, including the framework source in dev and the built
        // assets in production. A Studio boot pulls four hundred-odd ES modules
        // in one burst, so the module graph became a wall of 429s and the page
        // never rendered. Caught by the first end-to-end run; no earlier suite
        // loaded the Studio's real module graph against a real server.
        assert.equal(tierFor("/_nexus/src/studio/app.js"), "asset")
        assert.equal(tierFor("/studio/src/studio/kit/index.js"), "asset")
        assert.equal(tierFor("/favicon.ico"), "asset")
        // The surfaces worth protecting keep their tiers.
        assert.equal(tierFor("/api/v1/task"), "api")
        assert.equal(tierFor("/_studio/model"), "api")
        assert.equal(tierFor("/api/v1/_auth/verify"), "auth")

        // And a burst the size of a real boot passes.
        const limiter = createLimiter({ now: () => 0 })
        let allowed = 0
        for (let i = 0; i < 420; i++) if (limiter.check("1.2.3.4", tierFor("/_nexus/src/studio/app.js")).allowed) allowed++
        assert.equal(allowed, 420, "a page load must never be the thing that trips the limiter")
    })

    Test.it("RATE-11 INVARIANT: every declared tier reaches the built limiter, and every tierFor answer is one of them", () => {
        // How this was found: `asset` was added to TIERS but limiterFor listed
        // its tiers by hand, so check() never saw the name — and check() falls
        // back to the TIGHTEST tier for a name it does not know. The most
        // generous tier silently became the strictest, throttling the Studio's
        // own module loads to twenty and leaving the page unable to boot.
        // Fail-closed is the right default; a tier that can be FORGOTTEN is not.
        const limiter = limiterFor({})
        for (const name of Object.keys(TIERS))
            assert.truthy(limiter.tiers[name], `tier "${name}" is declared but never reaches the limiter`)

        // And every answer tierFor can give must be a tier that exists.
        for (const path of ["/api/v1/_auth/verify", "/api/v1/task", "/_studio/model", "/_nexus/src/studio/app.js", "/anything"])
            assert.truthy(limiter.tiers[tierFor(path)], `tierFor("${path}") names a tier the limiter does not have`)
    })

    Test.it("RATE-07 an operator can turn it OFF — an instance behind a proxy that already limits does not need a second limiter", () => {
        assert.equal(limiterFor({ limits: { enabled: false } }), null)
        assert.truthy(limiterFor({}), "and it is on by default")
        // Config overrides reach the tier, rather than the operator having to
        // set absurd numbers to approximate "off".
        const tuned = limiterFor({ limits: { auth: { burst: 3 } } })
        assert.equal(tuned.tightest.burst, 3)
    })
})

/** The tightest burst among a limiter's configured tiers — the fail-closed floor. */
const TIERS_TIGHTEST_BURST = (limiter) => limiter.tightest.burst
