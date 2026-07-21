/**
 * The secondary line of a list row — pure, DOM-free, so a clause can reach it
 * under Node. Anything that touches HTMLElement cannot be imported by the node
 * runner at all, which is why this is a module of its own rather than a helper
 * inside index.js (the same split as kit/tags.js and kit/registry.js).
 *
 * It exists because composing this line is LOGIC, not markup: jobs builds it
 * from an attempt count plus an optional schedule plus an optional error, and
 * joining those without dropping the empty ones printed the separators around
 * nothing — " · · " for a job that had neither.
 */

/**
 * @param {Array<string|false|null|undefined>} parts
 * @param {string} [separator]
 * @returns {string} the parts that are actually there, joined
 */
export const detailLine = (parts, separator = " · ") =>
    (parts ?? [])
        .map((part) => (typeof part === "string" ? part.trim() : part))
        .filter((part) => typeof part === "string" && part.length > 0)
        .join(separator)

export default { detailLine }
