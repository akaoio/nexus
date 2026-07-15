/**
 * Load content from files or directories.
 * Browser: HTTP-first with OPFS caching fallback, then registered miss
 * fallbacks (akao wired its torrent leech here — now app-registered).
 * Node.js: direct filesystem read.
 * Extracted from akao src/core/FS/load.js, decoupled: parsing goes through
 * the format registry (kernel ships JSON only); the akao-specific `.abi`
 * unwrapping is gone (app concern).
 *
 * @param {string|string[]|object} path
 * @returns {Promise<*>} Parsed content, raw text, Uint8Array for binary, or object map for dirs
 */

import { BROWSER, driver, isBinary } from "./shared.js"
import { join } from "./join.js"
import { format, fallbacks } from "./formats.js"

export async function load(path, options = {}) {
    const quiet = options.quiet === true
    const fresh = options.fresh === true

    if (typeof path === "string") path = [path]

    if (Array.isArray(path)) {
        const _path = join(path) // needed for fetch URL (browser) and ext detection
        let text

        if (BROWSER) {
            // Directory: load all children recursively
            if (await driver.isDir(path)) {
                const files = {}
                for (const name of await driver.list(path)) {
                    const child = await load([...path, name], options)
                    if (child !== undefined) files[name.replace(/\.\w{2,4}$/, "")] = child
                }
                return files
            }

            // File: HTTP first, OPFS fallback
            const _isBinary = isBinary(_path)
            let httpText = null
            let httpStatus = null
            try {
                const response = await fetch(_path)
                httpStatus = response.status
                if (response.ok) {
                    if (_isBinary) {
                        const buf = await response.arrayBuffer()
                        driver.writeBytes(path, new Uint8Array(buf)).catch((e) => console.warn("OPFS cache write failed:", e))
                        return new Uint8Array(buf)
                    }
                    httpText = await response.text()
                    driver.writeBytes(path, new TextEncoder().encode(httpText)).catch((e) => console.warn("OPFS cache write failed:", e))
                } else if (fresh && response.status === 404) await driver.remove(path)
            } catch {}

            if (fresh) {
                if (_isBinary) {
                    if (!quiet && httpStatus === 404) console.error("Path not found in HTTP:", _path)
                    return
                }
                if (httpText !== null) text = httpText
                else {
                    if (!quiet && httpStatus === 404) console.error("Path not found in HTTP:", _path)
                    return
                }
            } else if (_isBinary) {
                const buf = await driver.readBytes(path)
                if (buf) return buf

                const missed = await _miss(path)
                if (missed) return missed

                if (!quiet) console.error("Path not found in HTTP or OPFS:", _path)
                return
            }

            if (!fresh && httpText !== null) text = httpText
            else if (!fresh) {
                const buf = await driver.readBytes(path)
                if (buf) text = new TextDecoder().decode(buf)
                else {
                    const missed = await _miss(path)
                    if (missed) text = new TextDecoder().decode(missed)
                    else {
                        if (!quiet) console.error("Path not found in HTTP or OPFS:", _path)
                        return
                    }
                }
            }
        } else if (await driver.exists(path)) {
            // Node.js: disk read only
            if (await driver.isDir(path)) {
                const files = {}
                for (const { name } of await driver.entries(path)) {
                    const child = await load([...path, name], options)
                    if (child) files[name.replace(/\.\w{2,4}$/, "")] = child
                }
                return files
            }

            if (isBinary(_path)) return await driver.readBytes(path)
            const bytes = await driver.readBytes(path)
            if (!bytes) {
                if (!quiet) console.error("Error reading from", _path)
                return
            }
            text = new TextDecoder().decode(bytes)
        }

        // Deserialize text content through the format registry
        if (typeof text === "string") text = text.trim()
        const ext = _path.match(/\.\w+$/)?.[0]?.slice(1).toLowerCase() || ""
        const handlers = format(ext)
        if (typeof text === "string" && typeof handlers?.parse === "function")
            try {
                return handlers.parse(text)
            } catch {
                return text
            }

        return text
    }

    // Object input: load multiple paths in parallel as key-value pairs
    if (typeof path === "object" && path !== null) {
        const content = {}
        await Promise.all(
            Object.entries(path).map(async ([key, value]) => {
                content[key] = await load(value, options)
            })
        )
        return content
    }
}

/** Try registered miss fallbacks in order; first Uint8Array wins. */
async function _miss(path) {
    for (const fallback of fallbacks) {
        try {
            const bytes = await fallback(path)
            if (bytes) return bytes
        } catch {}
    }
    return null
}
