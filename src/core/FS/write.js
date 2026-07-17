/**
 * Write content to a file — serializes via the format registry, then
 * delegates I/O to the driver. Extracted from akao src/core/FS/write.js,
 * decoupled: no baked-in YAML/CSV — those register through formats.js.
 *
 * @param {string[]} path - Path segments including filename
 * @param {*} content - Content to write
 * @returns {Promise<{success: boolean, path: string}|undefined>}
 */

import { driver } from "./shared.js"
import { format } from "./formats.js"

export async function write(path = [], content) {
    if (content === undefined || content === null) return
    const file = path.at(-1)

    if (!file.includes(".") && typeof content === "object" && !(content instanceof String)) {
        console.error("Attempted to write object/array to path without extension:", path.join("/"))
        return
    }

    // Binary: pass through directly, no serialization needed
    if (content instanceof Uint8Array) return driver.writeBytes(path, content)

    // Serialize to string via the format registry; unregistered extensions
    // keep akao's behavior — strings raw, objects as JSON.
    const ext = file.slice(file.lastIndexOf(".") + 1).toLowerCase()
    const handlers = format(ext)
    let data
    if (typeof handlers?.stringify === "function") data = handlers.stringify(content)
    else data = typeof content === "string" ? content : JSON.stringify(content, null, 4)

    return driver.writeBytes(path, new TextEncoder().encode(data))
}
