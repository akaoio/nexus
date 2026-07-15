/**
 * Kernel utilities — the pure, dependency-free subset extracted from akao
 * src/core/Utils/ (data.js, random.js, time.js). Crypto, number formatting,
 * CSV and browser helpers stay app-side; the kernel carries only what the
 * kernel itself needs.
 */

export { NODE, BROWSER, WIN, DEV, detectEnvironment } from "./environment.js"

/** Deep clone plain data. Functions are stripped; circular references are preserved. */
export function clone(data, seen = new WeakMap()) {
    if (typeof data !== "object" || data === null) return data
    if (seen.has(data)) return seen.get(data)

    const copy = Array.isArray(data) ? [] : {}
    seen.set(data, copy)

    Object.entries(data).forEach(([key, value]) => {
        if (typeof value !== "function") copy[key] = clone(value, seen)
    })

    return copy
}

/**
 * Compare two objects and return the keys/values of b that differ from a.
 * Compares nested objects recursively; arrays compare shallowly by element.
 */
export function diff(a = {}, b = {}) {
    const result = {}

    for (const k in b)
        if (Object.prototype.hasOwnProperty.call(b, k))
            if (Array.isArray(b[k]) && Array.isArray(a[k])) {
                if (b[k].length !== a[k].length || !b[k].every((val, index) => val === a[k][index])) result[k] = b[k]
            } else if (typeof b[k] === "object" && b[k] !== null && !Array.isArray(b[k])) {
                const nest = diff(a[k] || {}, b[k])
                if (Object.keys(nest).length > 0) result[k] = nest
            } else if (b[k] !== a[k]) result[k] = b[k]

    return result
}

/** Deep-merge b into a (objects recurse; arrays and scalars overwrite). Mutates and returns a. */
export function merge(a, b) {
    if (typeof a !== "object" || typeof b !== "object") return
    for (const key in b)
        if (Object.prototype.hasOwnProperty.call(b, key))
            if (typeof b[key] === "object" && b[key] !== null && !Array.isArray(b[key])) a[key] = merge(a[key] || {}, b[key])
            else a[key] = b[key]

    return a
}

export function isPromise(item) {
    return !!item && (typeof item === "object" || typeof item === "function") && typeof item.then === "function"
}

export function randomInt(min, max) {
    min = Math.ceil(min || 0)
    max = Math.floor(max || 10000)
    return Math.floor(Math.random() * (max - min) + min)
}

export function randomText(l, c) {
    var s = ""
    l = l || 24
    c = c || "0123456789ABCDEFGHIJKLMNOPQRSTUVWXZabcdefghijklmnopqrstuvwxyz"
    while (l > 0) {
        s += c.charAt(Math.floor(Math.random() * c.length))
        l--
    }
    return s
}

/** Time-sortable random id: base36 timestamp + 7 random chars. */
export function randomKey(int) {
    return (int || Date.now()).toString(36) + randomText(7)
}

export function randomItem(data) {
    return Array.isArray(data) ? data[Math.floor(Math.random() * data.length)] : null
}

/** Returns the candle number for a given interval length (ms). */
export function now(length = 60000) {
    const time = Date.now()
    return length <= 0 || length == 1 ? time : Math.floor(time / length)
}
