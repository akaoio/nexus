/**
 * Gate 3 (docs/sync-design.md §3, §5) — the permission compiled to a REAL ZEN
 * PEN policy and evaluated by ZEN's policy VM (pen.wasm), not a re-implemented
 * check. This is the peer-verifiable, structural write gate: a write's soul
 * must address a known entity under this site's log. The same compiled
 * bytecode runs at every peer, so a plain ZEN relay enforces it without
 * trusting the writer.
 *
 * Honest scope (matches §6's table): PEN here enforces the STRUCTURAL subset —
 * a well-formed soul (`nexus/<site>/log/<entity>/<eventId>`) that names a known
 * entity. Per-author row/field rules over the JSON value remain gate 4 (the
 * design states they cannot be absolute in P2P). And making ZEN's OWN write
 * pipeline auto-run this policy for relays that never installed Nexus is a
 * ZEN-core capability (its security pipeline) — not faked here; Nexus peers run
 * the identical compiled bytecode via pen.run at ingest (gate 3), and gate 4
 * re-checks full permission regardless.
 *
 * Node/browser: loads pen.wasm through ZEN's own loader (fs in Node, fetch in
 * the browser). Opt-in — the sync engine only invokes it when a policy is set.
 */

let penModule = null

/** Load ZEN's PEN VM once (wasm init is async). */
export async function loadPen() {
    if (penModule) return penModule
    const pen = (await import("../../../vendor/zen/src/pen.js")).default
    await pen.ready
    penModule = pen
    return pen
}

/** The canonical log soul for an event (§3). */
export function logSoul(site, entity, eventId) {
    return `nexus/${site}/log/${entity}/${eventId}`
}

/**
 * Compile the site's structural write policy: a soul must be
 * `nexus/<site>/log/<entity>/…` with entity ∈ the known set. Returns the ZEN
 * policy string (a PEN soul) and the raw bytecode for pen.run.
 * @param {{site: string, entities: string[]}} config
 */
export async function compileEntityPolicy({ site, entities }) {
    if (!Array.isArray(entities) || !entities.length) throw new Error("E_PEN_ENTITIES: at least one entity required")
    const pen = await loadPen()
    const match = entities.length === 1 ? { eq: entities[0] } : { or: entities.map((e) => ({ eq: e })) }
    const spec = {
        soul: {
            and: [
                { seg: { sep: "/", idx: 0, match: { eq: "nexus" } } },
                { seg: { sep: "/", idx: 1, match: { eq: site } } },
                { seg: { sep: "/", idx: 2, match: { eq: "log" } } },
                { seg: { sep: "/", idx: 3, match } }
            ]
        }
    }
    const policy = pen.pen(spec)
    return { policy, bytecode: pen.unpack(policy.slice(1)) }
}

/**
 * Evaluate a compiled policy against a write's soul via ZEN's PEN VM.
 * @returns {Promise<boolean>} true = the graph would accept this write.
 */
export async function authorizeWrite(bytecode, soul) {
    const pen = await loadPen()
    return pen.run(bytecode, ["", "", String(soul)])
}

export default { loadPen, logSoul, compileEntityPolicy, authorizeWrite }
