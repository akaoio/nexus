/**
 * Selection model (Frappe list habits, as PURE logic): toggle one, check all,
 * uncheck all, INVERT (checked↔unchecked over the visible set), and range
 * semantics live here — views (list, kanban, …) are dumb consumers. No DOM,
 * fully clause-tested in Node.
 */

export function createSelection(onChange = () => {}) {
    const picked = new Set()
    const api = {
        /** Currently selected ids (insertion order not guaranteed). */
        get ids() {
            return [...picked]
        },
        get size() {
            return picked.size
        },
        has: (id) => picked.has(id),
        toggle(id) {
            picked.has(id) ? picked.delete(id) : picked.add(id)
            onChange(api)
            return api
        },
        /** Check every id in the visible set. */
        all(ids) {
            for (const id of ids) picked.add(id)
            onChange(api)
            return api
        },
        /** Frappe's invert: over the VISIBLE set, checked↔unchecked. */
        invert(ids) {
            for (const id of ids) picked.has(id) ? picked.delete(id) : picked.add(id)
            onChange(api)
            return api
        },
        clear() {
            picked.clear()
            onChange(api)
            return api
        },
        /** The tri-state of a visible set: "none" | "some" | "all". */
        stateOf(ids) {
            const n = ids.filter((id) => picked.has(id)).length
            return n === 0 ? "none" : n === ids.length ? "all" : "some"
        }
    }
    return api
}

export default { createSelection }
