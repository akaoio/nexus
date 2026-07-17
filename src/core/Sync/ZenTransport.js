/**
 * ZEN mesh transport for the Sync engine — REAL gossip over the vendored,
 * first-party ZEN graph, not the in-memory onemit stub.
 *
 * The mapping is exact and safe by construction:
 *   • Every event is already content-addressed (id = base62(SHA-256(canonical)))
 *     and secp256k1-signed. A peer publishes its events into its OWN outbox
 *     under `channel/out/<self>/<eventId>` — the content address is the leaf
 *     key, so re-publishing the same event is the same write (idempotent).
 *   • Each peer enumerates `channel/out` (the roster of peer outboxes) and, for
 *     every outbox, streams its events into `engine.ingest()`. ingest is itself
 *     idempotent (the duplicate gate) and confluent (row refold depends on the
 *     event SET, never arrival order), so delivery in ANY order converges to
 *     the same SQL projection — the network can carry state, never corrupt it.
 *
 * Why per-peer outboxes and not one shared set: ZEN streams a node's members
 * through map().on() only to a PURE subscriber — once a peer also writes into a
 * set, its own map stops seeing others' additions to that same set. Giving each
 * peer its own outbox keeps every peer a pure subscriber of every OTHER peer's
 * events, so gossip is fully bidirectional. A peer still re-reads its own outbox
 * (harmless duplicate). Gates 1/2 (signature + content address) run on every
 * inbound event, so an untrusted relay can neither forge nor mutate one in flight.
 *
 * Node-only: this pulls the mesh entry (index.js → server.js: yson/store/rfs/
 * wire/axe/dht/serve, all Node built-ins). The browser keeps signing/verifying
 * through zen.js directly — it never imports this file.
 */

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

/**
 * Open a ZEN mesh transport.
 * @param {Object} config
 * @param {string[]} [config.peers] - relay/peer URLs, e.g. ["http://host:PORT/zen"]
 * @param {string} [config.file] - local store path (distinct per peer)
 * @param {string} [config.channel="nexus"] - graph namespace for the roster
 * @param {string} [config.self] - this peer's stable outbox id (default random)
 * @param {Object} [config.graph] - an existing ZEN graph to reuse (tests/embed)
 * @returns {Promise<{zen, channel, self, attach(engine), publish(event), close()}>}
 */
export async function createZenTransport({ peers = [], file, channel = "nexus", self, graph } = {}) {
    let zen = graph
    if (!zen) {
        const ZEN = (await import("../../../vendor/zen/index.js")).default
        if (typeof ZEN.graph?.create !== "function") throw err("E_ZEN", "vendored ZEN has no graph.create (need the Node mesh entry)")
        zen = ZEN.graph.create({ peers, file, localStorage: false })
    }
    const selfId = self ?? "peer-" + Math.random().toString(36).slice(2, 12)
    const out = zen.get(channel).get("out")
    const mine = out.get(selfId)
    const engines = new Set()
    const timers = new Set()

    // A subscription issued before the WebSocket opens is never sent, and ZEN
    // streams a set through map() only while its parent stays subscribed. Re-
    // reference a node on a slow heartbeat so the subscription is (re)asserted
    // after the handshake and after any reconnect. Pure re-subscription (no
    // writes); the timer is unref'd and cleared on close().
    const arm = (node) => {
        node.on(() => {})
        const iv = setInterval(() => node.on(() => {}), 2000)
        if (typeof iv?.unref === "function") iv.unref()
        timers.add(iv)
    }

    /** Publish one signed event as an immutable content-addressed leaf. */
    const publish = (event) => {
        if (!event?.id) throw err("E_EVENT", "event has no content id")
        mine.get(event.id).put(JSON.stringify(event))
    }

    return {
        zen,
        channel,
        self: selfId,
        publish,
        /**
         * Bind a SyncEngine to the mesh: local appends publish into this peer's
         * outbox, and every peer outbox's events flow into ingest. Idempotent.
         */
        attach(engine) {
            if (engines.has(engine)) return
            engines.add(engine)
            engine.onemit = publish

            const ingest = (value) => {
                if (value == null) return
                let event
                try {
                    event = typeof value === "string" ? JSON.parse(value) : value
                } catch {
                    return // a malformed leaf is not an event — ignore, never throw
                }
                if (event && event.id) Promise.resolve(engine.ingest(event)).catch(() => {})
            }

            // Enumerate the roster of peer outboxes; for each, stream its events.
            // Each outbox is written by exactly one peer, so every subscriber is
            // a pure reader of it — the condition ZEN needs for map() delivery.
            arm(out)
            const seen = new Set()
            out.map().on((_peerNode, peerId) => {
                if (peerId == null || seen.has(peerId)) return
                seen.add(peerId)
                const outbox = out.get(peerId)
                arm(outbox)
                outbox.map().on(ingest)
            })
        },
        close() {
            for (const iv of timers) clearInterval(iv)
            timers.clear()
            for (const engine of engines) if (engine.onemit === publish) engine.onemit = null
            engines.clear()
            try {
                zen.off?.()
            } catch {}
        }
    }
}

export default { createZenTransport }
