/**
 * Live events — ONE shared EventSource multiplexing every subscriber (the
 * Studio router has no unmount hook, so per-call connections would leak a
 * browser connection per navigation until the HTTP/1.1 per-origin cap
 * starves the API). The connection carries the UNION of all subscribers'
 * entity lists and is replaced whenever that union CHANGES — including when it
 * shrinks, so a route that unsubscribes actually narrows the connection rather
 * than leaving the server evaluating permission for entities nothing is
 * watching. (This header used to say "only when the union grows", which
 * understated what `ensure()` does — it compares the whole key.) Each
 * subscriber filters client-side. EventSource cannot set headers → ?token=.
 */

const subs = new Set() // { entities: string[]|null, onEvent }
let source = null
let connectedKey = null
const seen = new Set()

// A null-entities sub wants the server default set (everything except
// nexus_job). Mixing a null sub with an explicit sub under-serves the
// explicit sub in this scheme; the five current routes all pass explicit
// lists, so in practice this stays exact — known simplification.
export const unionKey = () => {
    if ([...subs].some((s) => !s.entities)) return "" // a null sub wants the default set
    const union = new Set([...subs].flatMap((s) => s.entities))
    return [...union].sort().join(",")
}

/**
 * Whether the link has a GAP to cover.
 *
 * STATUS listed `Last-Event-ID` replay as deferred work; reading what the
 * stream carries withdraws it instead. The wire holds {entity,event,id,ts} and
 * never row data, so an event is a notification to REFETCH — and a refetch
 * already supersedes any replay of them, with the current truth rather than a
 * history of intermediate states. Replay would additionally cost retention the
 * hub deliberately does not have, and a decision about whose visibility applies
 * to historical events, which is the exact shape of the after:remove id leak
 * (I11) this project already closed.
 *
 * What was missing is the recovery replay stood in for: STATUS says a client
 * "recovers by refetching", and nothing made it refetch. A route subscribed
 * across a network blip showed stale data indefinitely — silently, because the
 * page looks fine and is wrong.
 *
 * The distinction this tracks has to be exact. A connection replaced
 * DELIBERATELY — the entity union changed because a route mounted or
 * unmounted — covers no gap and must not resync, or every navigation would
 * reload every list. Only a connection that was LOST leaves a hole.
 *
 * Extracted because it is a three-input state machine and this module is
 * reachable from Node, where there is no EventSource to drive it through.
 */
export function createLinkState() {
    let gap = false
    return {
        /** The link went down. A retry may be pending (the browser's, or ours). */
        drop() { gap = true },
        /** The link is up. @returns true when subscribers must resync. */
        open() {
            const had = gap
            gap = false
            return had
        },
        /**
         * The link was replaced on purpose. Note this does NOT clear an
         * outstanding gap: events missed while it was down are still missed,
         * and a union change during an outage must not erase that.
         */
        replace() {},
        get hasGap() { return gap }
    }
}

const link = createLinkState()

/**
 * Tell every subscriber it may have missed events. Delivered past the entity
 * filter — "you may have missed something" is not about any one entity — and
 * past the dedupe set, which keys on entity/id/ts a resync does not have and
 * would collapse every one of them into a single swallowed event.
 */
export function notifyResync() {
    for (const s of [...subs]) {
        try {
            s.onEvent({ type: "resync" })
        } catch (error) {
            // Contained like every other subscriber callback: one route's bad
            // reload must not stop the others from recovering.
            console.warn("live events: a resync handler threw —", error)
        }
    }
}

function ensure() {
    // No EventSource means no live events, and that is not an error: this
    // module is reachable from a non-browser context (the `nexus studio build`
    // import-graph walk, and the Node clauses that assert the union logic).
    // Bookkeeping still runs — only the connection is skipped.
    if (typeof EventSource === "undefined") return
    const key = unionKey()
    if (source && key === connectedKey && source.readyState !== EventSource.CLOSED) return
    source?.close()
    source = null
    if (!subs.size) { connectedKey = null; return }
    const params = new URLSearchParams()
    if (key) params.set("entities", key)
    const token = globalThis.localStorage?.getItem("nexus-token")
    if (token) params.set("token", token)
    const qs = params.toString()
    source = new EventSource("/api/v1/_events" + (qs ? "?" + qs : ""))
    connectedKey = key
    link.replace()
    source.onopen = () => {
        if (link.open()) notifyResync()
    }
    source.onerror = () => {
        if (source?.readyState !== EventSource.CLOSED) {
            link.drop() // the browser is retrying — whatever arrives meanwhile is missed
            return
        }
        console.warn("live events: connection closed — retrying in 5s")
        link.drop()
        source = null
        connectedKey = null
        setTimeout(ensure, 5000) // reconnect re-reads the token from localStorage, which is what
        // makes a post-re-login session (or a mid-session token expiry) recover
    }
    source.onmessage = (e) => {
        if (!e?.data) return
        try {
            const event = JSON.parse(e.data)
            const dedupe = `${event.entity}:${event.id}:${event.ts}`
            if (seen.has(dedupe)) return
            seen.add(dedupe)
            if (seen.size > 512) seen.clear()
            for (const s of subs) if (!s.entities || s.entities.includes(event.entity)) s.onEvent(event)
        } catch { /* not ours */ }
    }
}

export function subscribe(entities, onEvent) {
    const sub = { entities: entities?.length ? [...entities] : null, onEvent }
    subs.add(sub)
    ensure()
    return () => { subs.delete(sub); ensure() }
}

/** How many subscribers are live. Observability, and EVT-UNION-*. */
export const subscriberCount = () => subs.size

export default { subscribe, unionKey, subscriberCount, createLinkState, notifyResync }
