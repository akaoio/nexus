/**
 * ZEN challenge–response auth (docs/authn-design.md §1, tier 1) — the real
 * identity path, completing what the interim API keys stood in for.
 *
 * Flow: server issues a nonce → client signs it with its ZEN key (derived
 * deterministically from a WebAuthn credential, or any seed in tests) →
 * server recovers the public key from the signature and checks the signed
 * message is a live nonce → issues a short-lived TOKEN carrying { user: pub,
 * roles, exp }, HMAC-signed by the site secret. Later requests present the
 * token; no private key ever leaves the client, no password is stored.
 *
 * Node-only (HMAC via node:crypto, reached through process.getBuiltinModule
 * so this module never breaks a browser import). ZEN is vendored.
 */

const ZEN = (await import("../../../vendor/zen/zen.js")).default

const b64url = (buf) => Buffer.from(buf).toString("base64url")
const fromB64url = (s) => Buffer.from(s, "base64url")
const hmac = (data, secret) =>
    process.getBuiltinModule("crypto").createHmac("sha256", secret).update(data).digest("base64url")

/** Constant-time equality over two base64url strings (token signatures). */
function safeEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

/**
 * Verify a ZEN challenge signature: the signature must recover to `pub` AND
 * its signed message must equal `nonce`. Returns true/false, never throws.
 */
export async function verifyChallenge(pub, nonce, signature) {
    if (typeof pub !== "string" || typeof signature !== "string") return false
    try {
        if ((await ZEN.recover(signature)) !== pub) return false
        return (await ZEN.verify(signature, pub)) === nonce
    } catch {
        return false
    }
}

/**
 * Issue a signed session token.
 * @param {{user: string, roles?: string[]}} claims
 * @param {string} secret - The site token secret
 * @param {number} [ttlMs=3600000] - Lifetime (default 1h)
 */
export function issueToken(claims, secret, ttlMs = 3600000, now = Date.now()) {
    const payload = b64url(JSON.stringify({ user: claims.user, roles: claims.roles ?? [], exp: now + ttlMs }))
    return `${payload}.${hmac(payload, secret)}`
}

/**
 * Verify and decode a token. Returns { user, roles } or null (bad shape,
 * bad signature, or expired). Never throws.
 */
export function verifyToken(token, secret, now = Date.now()) {
    if (typeof token !== "string" || !token.includes(".")) return null
    const [payload, signature] = token.split(".")
    if (!safeEqual(signature ?? "", hmac(payload, secret))) return null
    try {
        const claims = JSON.parse(fromB64url(payload).toString("utf8"))
        if (typeof claims.exp !== "number" || claims.exp < now) return null
        return { user: claims.user, roles: Array.isArray(claims.roles) ? claims.roles : [] }
    } catch {
        return null
    }
}

export default { verifyChallenge, issueToken, verifyToken }
