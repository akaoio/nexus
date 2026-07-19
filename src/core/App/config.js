/**
 * Config editing — the primitives behind `nexus config` (the bench-style
 * control plane). Pure dot-path get/set/unset over nexus.config.json, value
 * coercion, and secret redaction. The CLI and any Studio settings panel share
 * these so there is one safe way to edit the config.
 */

/** Read a dot-path (`database.engine`) from an object; undefined if absent. */
export function getPath(obj, path) {
    if (!path) return obj
    return path.split(".").reduce((o, k) => (o == null ? undefined : o[k]), obj)
}

/** Return a copy of `obj` with the dot-path set to `value` (creates parents). */
export function setPath(obj, path, value) {
    const keys = path.split(".")
    const next = JSON.parse(JSON.stringify(obj ?? {}))
    let cur = next
    for (let i = 0; i < keys.length - 1; i++) {
        if (typeof cur[keys[i]] !== "object" || cur[keys[i]] === null) cur[keys[i]] = {}
        cur = cur[keys[i]]
    }
    cur[keys.at(-1)] = value
    return next
}

/** Return a copy of `obj` with the dot-path removed (no-op if absent). */
export function unsetPath(obj, path) {
    const keys = path.split(".")
    const next = JSON.parse(JSON.stringify(obj ?? {}))
    let cur = next
    for (let i = 0; i < keys.length - 1; i++) {
        if (cur[keys[i]] == null || typeof cur[keys[i]] !== "object") return next
        cur = cur[keys[i]]
    }
    delete cur[keys.at(-1)]
    return next
}

/**
 * Coerce a CLI string to a value: JSON when it parses (number/bool/null/array/
 * object), else the raw string. `forceString` keeps it a string ("42" → "42").
 */
export function coerce(raw, forceString = false) {
    if (forceString) return raw
    try {
        return JSON.parse(raw)
    } catch {
        return raw
    }
}

/**
 * A copy with secrets masked (token_secret, api_keys[].key, mail.smtp) — safe
 * to print. `mail.smtp` masks as a whole block (host/user/pass can all leak
 * credentials via SMTP auth) while `mail.provider`/`mail.from` stay readable.
 */
export function redact(config) {
    const c = JSON.parse(JSON.stringify(config ?? {}))
    if (c.token_secret) c.token_secret = "***"
    if (Array.isArray(c.api_keys)) c.api_keys = c.api_keys.map((k) => ({ ...k, key: "***" }))
    if (c.mail && typeof c.mail === "object" && c.mail.smtp !== undefined) c.mail = { ...c.mail, smtp: "***" }
    return c
}

/** Is this dot-path a secret (so `get` should mask it unless asked)? */
export function isSecretPath(path) {
    return (
        path === "token_secret" ||
        path === "api_keys" ||
        /^api_keys\.\d+\.key$/.test(path) ||
        path === "mail.smtp" ||
        path.startsWith("mail.smtp.")
    )
}

export default { getPath, setPath, unsetPath, coerce, redact, isSecretPath }
