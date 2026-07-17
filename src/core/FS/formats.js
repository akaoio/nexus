/**
 * Format registry — the kernel's decoupling of file formats from file I/O.
 *
 * akao's FS baked YAML (an npm dependency) and CSV (an app-level format)
 * into load/write. The kernel is zero-dependency (N2) and minimal (N5):
 * it ships JSON only; anything else registers from the app side:
 *
 *   registerFormat("yaml", { parse: YAML.parse, stringify: YAML.stringify })
 *   registerFormat("csv",  { parse: ..., stringify: ... })
 *
 * Unregistered text extensions round-trip as raw strings; unregistered
 * extensions written with an object value serialize as JSON (akao behavior).
 *
 * Miss fallbacks (browser): when a file is found neither over HTTP nor in
 * OPFS, registered fallbacks run in order (akao hard-wired its torrent
 * leech here — that now registers from the app side):
 *
 *   registerFallback(async (path) => Uint8Array | null)
 */

import { TEXT_EXTS } from "./shared.js"

const FORMATS = new Map()

/**
 * Register (or override) a parser/stringifier pair for a file extension.
 * Registering a format also declares the extension as text — load/write
 * route it through the text path so the parser actually sees a string.
 */
export function registerFormat(ext, { parse, stringify } = {}) {
    if (typeof ext !== "string" || !ext) throw new Error("registerFormat: ext must be a non-empty string")
    const key = ext.toLowerCase()
    FORMATS.set(key, { parse, stringify })
    if (!TEXT_EXTS.includes(key)) TEXT_EXTS.push(key)
}

/** Look up the format handlers for an extension (undefined when unregistered). */
export function format(ext) {
    return FORMATS.get(String(ext).toLowerCase())
}

/** Miss fallbacks — tried in registration order by load() on a browser miss. */
export const fallbacks = []

export function registerFallback(fn) {
    if (typeof fn === "function") fallbacks.push(fn)
}

// The kernel's only built-in format.
registerFormat("json", {
    parse: (text) => JSON.parse(text),
    stringify: (value) => JSON.stringify(value, null, 4)
})
