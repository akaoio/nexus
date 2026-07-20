/**
 * Live events — the Studio consumes the PUBLIC stream (/api/v1/_events),
 * dogfooding §361: if the Studio can live-refresh with it, any client can.
 * EventSource cannot set headers, so the session token rides ?token=.
 */

export function subscribe(entities, onEvent) {
    const token = localStorage.getItem("nexus-token")
    const params = new URLSearchParams()
    if (entities?.length) params.set("entities", entities.join(","))
    if (token) params.set("token", token)
    const qs = params.toString()
    const source = new EventSource("/api/v1/_events" + (qs ? "?" + qs : ""))
    const seen = new Set()
    source.onmessage = (e) => {
        if (!e?.data) return
        try {
            const event = JSON.parse(e.data)
            const key = `${event.entity}:${event.id}:${event.ts}`
            if (seen.has(key)) return
            seen.add(key)
            if (seen.size > 512) seen.clear() // bounded dedup memory
            onEvent(event)
        } catch { /* not ours */ }
    }
    return () => source.close()
}

export default { subscribe }
