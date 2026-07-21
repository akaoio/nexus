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
    source.onerror = () => {
        if (source?.readyState !== EventSource.CLOSED) return // transient; the browser retries on its own
        console.warn("live events: connection closed — retrying in 5s")
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

export default { subscribe, unionKey, subscriberCount }
