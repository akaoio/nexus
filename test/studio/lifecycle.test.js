/**
 * Studio route lifecycle and keyboard access (LIFE-UNMOUNT-*, EVT-UNION-*,
 * NXSR-KEY-*) — ARCHITECTURE.md §12's unfinished UI layer, and the two items
 * STATUS discloses: the router having no unmount hook, and the search overlay
 * having no keyboard navigation.
 *
 * The router's missing hook was being paid for at FIVE call sites in an
 * identical line:
 *
 *     if (!host.isConnected) return unsubscribe()  // stale routes reap themselves
 *
 * which reaps a subscription only when the NEXT event arrives — so on a quiet
 * instance a navigation leaks a subscriber permanently, and the shared
 * EventSource keeps carrying entities nothing on screen is watching. It also
 * only ever reaped subscriptions: `routes/jobs` holds a setTimeout the pattern
 * could not touch, so a burst-collapse timer scheduled just before navigating
 * still fired against a dead route.
 *
 * Everything below runs under Node. That is the point of extracting the logic
 * rather than embedding it in event handlers — a `{ browser: true }` clause
 * here would be a claim nobody checks.
 */

import { readFileSync, readdirSync } from "fs"
import { fileURLToPath } from "url"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { onUnmount, unmountCurrent, commitMount, mountedCount } from "../../src/studio/kit/lifecycle.js"
import { nextIndex } from "../../src/studio/components/search/index.js"
import { subscribe, unionKey, subscriberCount } from "../../src/studio/kit/events.js"

const ROUTES_DIR = fileURLToPath(new URL("../../src/studio/routes", import.meta.url))

/** Drive one full mount cycle the way the router does. */
const mount = (routeRender) => {
    unmountCurrent()
    routeRender()
    commitMount()
}

Test.describe("Studio route lifecycle (LIFE-UNMOUNT)", () => {

    Test.it("LIFE-UNMOUNT-01 what a route registers is torn down when the next route mounts — once, and not before", () => {
        const torn = []
        mount(() => {
            onUnmount(() => torn.push("subscription"))
            onUnmount(() => torn.push("timer"))
        })

        assert.deepEqual(torn, [], "a mounted route must keep what it took")
        assert.equal(mountedCount(), 2)

        mount(() => {})
        assert.deepEqual(torn, ["subscription", "timer"], "leaving the page releases both — including the timer the old pattern could not reach")
        assert.equal(mountedCount(), 0)

        mount(() => {})
        assert.deepEqual(torn, ["subscription", "timer"], "and never again")
    })

    Test.it("LIFE-UNMOUNT-02 a teardown that throws does not stop the others, and does not break navigation", () => {
        // One route's bad cleanup taking the Studio down would be a worse
        // failure than the leak it was cleaning up — the same containment
        // doctrine the event hub and the plane's after-hooks already run under.
        const torn = []
        mount(() => {
            onUnmount(() => { throw new Error("cleanup blew up") })
            onUnmount(() => torn.push("still ran"))
        })

        mount(() => {}) // must not throw
        assert.deepEqual(torn, ["still ran"])
    })

    Test.it("LIFE-UNMOUNT-03 re-rendering the SAME route unmounts first — a locale change must not accumulate subscriptions", () => {
        let live = 0
        const route = () => { live++; onUnmount(() => live--) }

        mount(route)
        assert.equal(live, 1)
        mount(route) // same route again, e.g. after i18n.set()
        assert.equal(live, 1, "one alive, not two — otherwise the leak is back with extra steps")
        mount(route)
        assert.equal(live, 1)
    })

    Test.it("LIFE-UNMOUNT-04 teardowns from a render that never committed are discarded, not billed to the next route", () => {
        const torn = []
        unmountCurrent()
        onUnmount(() => torn.push("abandoned")) // a render that threw before commitMount()

        mount(() => {}) // the next route mounts cleanly
        assert.deepEqual(torn, [], "an uncommitted registration belongs to nobody")
        assert.equal(mountedCount(), 0)
    })

    Test.it("NXSR-KEY-02 INVARIANT: no route reaches for host.isConnected — the incantation cannot creep back", () => {
        // Structural, in the style of STUDIO-10/PROD-01: the fix is only
        // durable if re-introducing the old shape fails a clause rather than
        // merely looking out of place in review.
        const offenders = []
        const walk = (dir) => {
            for (const entry of readdirSync(dir, { withFileTypes: true })) {
                const path = join(dir, entry.name)
                if (entry.isDirectory()) walk(path)
                else if (entry.name.endsWith(".js") && /host\.isConnected/.test(readFileSync(path, "utf8")))
                    offenders.push(path.slice(ROUTES_DIR.length + 1))
            }
        }
        walk(ROUTES_DIR)
        assert.deepEqual(offenders, [], `routes must register teardown with onUnmount(), not poll isConnected: ${offenders.join(", ")}`)
    })
})

Test.describe("Shared event connection narrows too (EVT-UNION)", () => {

    Test.it("EVT-UNION-01 the connection key NARROWS when a subscriber leaves, not only widens when one arrives", () => {
        // The module header used to claim the connection is "replaced only when
        // the union grows". It is replaced on any key change — but nothing
        // asserted that, and a later reader could have "fixed" the code to
        // match the comment, which is how a stale-subscriber leak becomes a
        // permanently over-broad connection.
        const offA = subscribe(["task"], () => {})
        const offB = subscribe(["nexus_user"], () => {})
        assert.equal(unionKey(), "nexus_user,task")

        offB()
        assert.equal(unionKey(), "task", "leaving must shrink the union")
        offA()
    })

    Test.it("EVT-UNION-02 the last subscriber leaving takes the connection with it", () => {
        const off = subscribe(["task"], () => {})
        assert.equal(subscriberCount(), 1)
        off()
        assert.equal(subscriberCount(), 0, "no subscribers means no connection to keep open")
        assert.equal(unionKey(), "", "and nothing to reconnect for")
    })
})

Test.describe("Studio search keyboard navigation (NXSR-KEY)", () => {

    Test.it("NXSR-KEY-01 arrow navigation wraps, opens upward from nothing, and refuses to select in an empty list", () => {
        // The overlay had NO keydown handling at all — not merely no arrows.
        // A keyboard or screen-reader user could not reach a result.
        assert.equal(nextIndex(0, 3, "ArrowDown"), 1)
        assert.equal(nextIndex(2, 3, "ArrowDown"), 0, "a results list is a cycle; stopping at the end reads as broken")
        assert.equal(nextIndex(0, 3, "ArrowUp"), 2)

        // Nothing selected + ArrowUp opens the LAST item — what every command
        // palette does, and what makes the overlay usable without a mouse.
        assert.equal(nextIndex(-1, 3, "ArrowUp"), 2)
        assert.equal(nextIndex(-1, 3, "ArrowDown"), 0)

        assert.equal(nextIndex(1, 3, "Home"), 0)
        assert.equal(nextIndex(1, 3, "End"), 2)

        // An empty list has nothing to select, so Enter must do nothing rather
        // than open a hit that is not there.
        assert.equal(nextIndex(-1, 0, "ArrowDown"), -1)
        assert.equal(nextIndex(-1, 0, "ArrowUp"), -1)

        assert.equal(nextIndex(1, 3, "a"), 1, "an unrelated key changes nothing")
    })
})
