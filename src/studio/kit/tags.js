/**
 * Tag-list values — the JSON a `text` column actually stores when a field holds
 * a set of names (`nexus_user.roles` is the case that forced this out).
 *
 * BROWSER-SAFE AND DOM-FREE on purpose, the same split as Data/transaction.js:
 * the *rule* is pure logic and belongs where a clause can reach it under Node,
 * while the widget that uses it needs a document. `kit/fields.js` pulls in the
 * component barrel, so anything left in there is browser-only by construction
 * — which is how three call sites ended up with three ideas of what a
 * malformed value means.
 */

/**
 * Read a stored tag list defensively. Rows written before this existed, or by
 * hand, must not blank the editor — and the two things a free-entry picker
 * reliably produces are duplicates and blanks.
 */
export function parseTags(raw) {
    if (!raw) return []
    let parsed
    try {
        parsed = JSON.parse(raw)
    } catch {
        return [] // malformed reads as empty; it must never throw into a render
    }
    if (!Array.isArray(parsed)) return [] // a JSON string is not a one-item list
    const seen = new Set()
    for (const item of parsed) {
        const value = String(item ?? "").trim()
        if (value) seen.add(value)
    }
    return [...seen]
}

/** The inverse, so the two directions cannot disagree. */
export const serializeTags = (tags) =>
    JSON.stringify([...new Set((tags ?? []).map((tag) => String(tag ?? "").trim()).filter(Boolean))])

export default { parseTags, serializeTags }
