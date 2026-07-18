/**
 * Studio data cache — the akao DB.js thinking (offline-first, IDB-backed)
 * applied to the Data Plane: rows are painted from IndexedDB INSTANTLY, then
 * revalidated from the network (stale-while-revalidate); when the network is
 * gone the cached copy still serves — the Studio opens and reads offline.
 * Built on the kernel IDB (KRN-ID clauses), akao chain API.
 */

import IDB from "/_nexus/src/core/IDB.js"

const idb = new IDB({ name: "nexus-studio" })

/** Last-known value for a key, or undefined (never throws). */
export async function cached(key) {
    try {
        return await idb.get(key).once()
    } catch {
        return undefined
    }
}

/** Remember a value (never throws). */
export async function remember(key, value) {
    try {
        await idb.get(key).put(value)
    } catch {}
}

export default { cached, remember }
