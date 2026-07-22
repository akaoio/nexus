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
import { subscribe, unionKey, subscriberCount, createLinkState, notifyResync } from "../../src/studio/kit/events.js"

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

Test.describe("Realtime recovery after a dropped link (EVTSYNC)", () => {
    // STATUS listed `Last-Event-ID` replay as deferred work. Reading what the
    // stream carries withdraws it instead: the wire holds {entity,event,id,ts}
    // and NEVER row data, so an event is a notification to refetch — and a
    // refetch already supersedes any replay of them, with the current truth
    // rather than a history of intermediate states. Replay would cost
    // retention the hub deliberately does not have, plus a decision about
    // whose visibility applies to historical events, which is the exact shape
    // of I11, the after:remove id leak this project already closed.
    //
    // What deserved to exist is the recovery replay was standing in for.
    // STATUS says a client "recovers by refetching"; nothing made it refetch.
    // A route subscribed across a network blip showed stale data indefinitely
    // — silently, because the page looks fine and is wrong.

    Test.it("EVTSYNC-01 a link that DROPPED and reopened resyncs; one replaced deliberately does not", () => {
        // The distinction has to be exact. A connection replaced because the
        // entity union changed (a route mounted or unmounted) is not a gap in
        // coverage; only a connection that was LOST leaves a hole. Resyncing on
        // every union change would reload every list on every navigation.
        const link = createLinkState()

        assert.equal(link.open(), false, "the very first connect has missed nothing")

        link.drop()
        assert.equal(link.open(), true, "a reconnect after a drop must resync")

        // A replacement with no drop behind it covers nothing and must stay quiet.
        link.replace()
        assert.equal(link.open(), false, "a deliberate replacement is not a gap")
    })

    Test.it("EVTSYNC-02 ONE resync per drop, however many opens follow", () => {
        const link = createLinkState()
        link.drop()
        assert.equal(link.open(), true)
        assert.equal(link.open(), false, "the gap was already covered by the first refetch")
        assert.equal(link.open(), false)

        // A drop while already dropped (retry failed, retried again) is still
        // one gap, not two.
        link.drop()
        link.drop()
        assert.equal(link.open(), true)
        assert.equal(link.open(), false)

        // The one that is easy to get backwards: a deliberate replacement
        // DURING an outstanding drop must NOT erase the gap. A route mounting
        // mid-outage changes the entity union and replaces the connection, but
        // the events missed while it was down are still missed — swallowing
        // that would leave exactly the stale page this whole clause is about.
        link.drop()
        link.replace()
        assert.equal(link.open(), true, "a union change during an outage must not swallow the gap")
    })

    Test.it("EVTSYNC-03 a resync reaches EVERY subscriber, past the entity filter and past the dedupe set", () => {
        // A resync carries no entity/id/ts, so the dedupe key would collapse
        // every one of them into a single swallowed event; and "you may have
        // missed something" is not about any one entity, so an entity filter
        // must not hold it back either.
        const seen = []
        const offA = subscribe(["task"], (e) => seen.push(["A", e.type]))
        const offB = subscribe(["note"], (e) => seen.push(["B", e.type]))
        try {
            notifyResync()
            notifyResync()
            assert.deepEqual(seen, [["A", "resync"], ["B", "resync"], ["A", "resync"], ["B", "resync"]])
        } finally {
            offA()
            offB()
        }
    })

    Test.it("EVTSYNC-04 the WIRING: a dropped EventSource that reconnects makes every subscriber refetch", () => {
        // What is faked here is the BROWSER's retry machinery — reconnecting
        // after a drop is the browser's job and not ours to re-implement — and
        // what is under test is our reaction to it. No server can be asked to
        // drop a connection on cue from inside a page, so this fake is the
        // instrument in a browser run too; Node is simply the cheaper host.
        const created = []
        class FakeEventSource {
            static CLOSED = 2
            static CONNECTING = 0
            constructor(url) {
                this.url = url
                this.readyState = FakeEventSource.CONNECTING
                created.push(this)
            }
            close() { this.readyState = FakeEventSource.CLOSED }
        }
        const had = Object.getOwnPropertyDescriptor(globalThis, "EventSource")
        globalThis.EventSource = FakeEventSource
        const reloads = []
        let off = null
        try {
            off = subscribe(["task"], (e) => reloads.push(e.type ?? e.event))
            const es = created.at(-1)
            assert.truthy(es, "subscribing must open a connection")

            // The first connect has missed nothing.
            es.onopen?.()
            assert.deepEqual(reloads, [], "the first connect must not trigger a refetch")

            // The link drops. The browser will retry on its own — readyState
            // CONNECTING is exactly that signal — and whatever is emitted in
            // the meantime is lost.
            es.readyState = FakeEventSource.CONNECTING
            es.onerror?.()
            assert.deepEqual(reloads, [], "a drop alone refetches nothing — there is nowhere to fetch from yet")

            // …and comes back. THIS is the moment the route was never told
            // about, and why a network blip left a page stale indefinitely.
            es.onopen?.()
            assert.deepEqual(reloads, ["resync"], "a reconnect after a drop must make the route refetch")

            // Steady state again: further opens cover nothing new.
            es.onopen?.()
            assert.deepEqual(reloads, ["resync"])
        } finally {
            off?.()
            if (had) Object.defineProperty(globalThis, "EventSource", had)
            else delete globalThis.EventSource
        }
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
