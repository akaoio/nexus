/**
 * Route lifecycle — the unmount hook the Studio router did not have.
 *
 * Before this, a route that took something (an SSE subscription, a timer) had
 * no moment at which to give it back, so five routes carried the same line:
 *
 *     if (!host.isConnected) return unsubscribe()
 *
 * which releases the subscription only when the NEXT event arrives. On a quiet
 * instance a navigation therefore leaked a subscriber permanently, and the
 * shared EventSource kept carrying entities nothing on screen was watching.
 * Worse, it is subscription-shaped: `routes/jobs` also holds a `setTimeout`
 * that the pattern could not reach at all, so a burst-collapse timer scheduled
 * moments before navigating still fired against a dead route.
 *
 * Usage — a route registers teardown while it renders:
 *
 *     onUnmount(subscribe(["nexus_job"], onEvent))
 *     onUnmount(() => clearTimeout(reloadTimer))
 *
 * and the router brackets each render:
 *
 *     unmountCurrent(); const node = route.render(ctx); commitMount()
 *
 * WHY A REGISTRY THIS SMALL IS CORRECT: every route's `render()` is
 * SYNCHRONOUS — they return a host node and fill it asynchronously afterwards.
 * So "whatever was registered during this call belongs to this route" is exact
 * rather than a heuristic. If a route ever becomes `async`, that stops being
 * true and this model needs revisiting; LIFE-UNMOUNT-04 pins the adjacent
 * property (an uncommitted registration belongs to nobody) so a half-migrated
 * async route cannot silently attribute its teardown to its successor.
 */

/** Teardowns registered by the route currently rendering. */
let pending = []
/** Teardowns of the route currently on screen. */
let mounted = []

/** Register a teardown for the route being rendered right now. */
export function onUnmount(fn) {
    if (typeof fn === "function") pending.push(fn)
}

/**
 * Release everything the on-screen route took. Called by the router BEFORE it
 * renders the next one — including when the next one is the SAME route, since
 * a re-render (a locale change) that skipped this would leave the old
 * subscription running alongside the new one.
 *
 * A teardown that throws is contained: one route's bad cleanup taking the
 * Studio down would be a worse failure than the leak it was cleaning up. Same
 * doctrine as the event hub's visible() and the plane's after-hooks — reported,
 * never propagated.
 */
export function unmountCurrent() {
    for (const fn of mounted) {
        try {
            fn()
        } catch (error) {
            console.warn(`studio: a route teardown failed — ${String(error?.message ?? error)}`)
        }
    }
    mounted = []
    pending = [] // a render that threw before committing leaves nothing behind
}

/** Adopt what the just-rendered route registered. Called AFTER render() returns. */
export function commitMount() {
    mounted = pending
    pending = []
}

/** How many teardowns the on-screen route holds. Observability, and LIFE-UNMOUNT-01. */
export const mountedCount = () => mounted.length

export default { onUnmount, unmountCurrent, commitMount, mountedCount }
