/**
 * WebAuthn PRF → ZEN identity (docs/authn-design.md) — the client-side binding
 * the design left as the last authn seam. WebAuthn does not hand out a random
 * keypair; it yields a STABLE per-credential secret (the PRF extension output).
 * Nexus hashes that secret into a seed and derives a keypair deterministically
 * with `ZEN.pair(null, { seed })` — the same credential always gives the same
 * public key, and no private key is ever stored anywhere.
 *
 * The derivation (prfSeed, identityFromPRF) is pure and deterministic — proven
 * hardware-free in tests. Only READING the PRF output needs a real authenticator
 * (a security key or platform authenticator, or a CDP virtual authenticator in
 * a browser test); that step is inherently interactive and is the one honest
 * hardware boundary. The ceremony helpers below wrap the standard WebAuthn calls
 * for that step; they are not mocked.
 */

const enc = () => (typeof TextEncoder !== "undefined" ? new TextEncoder() : new (require("util").TextEncoder)())

/** SHA-256 of arbitrary bytes → lowercase hex, via Web Crypto (browser + Node ≥ 20). */
async function sha256Hex(bytes) {
    const subtle = (globalThis.crypto ?? {}).subtle
    if (!subtle) throw new Error("E_NOCRYPTO: Web Crypto subtle unavailable")
    const digest = await subtle.digest("SHA-256", bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
    return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("")
}

/**
 * Hash a PRF output (an ArrayBuffer/Uint8Array from the authenticator) into the
 * deterministic seed string. A domain tag keeps this seed distinct from any
 * other use of the same PRF secret.
 * @param {ArrayBuffer|Uint8Array} prfOutput
 * @param {string} [domain="nexus-identity-v1"]
 * @returns {Promise<string>} hex seed
 */
export async function prfSeed(prfOutput, domain = "nexus-identity-v1") {
    const raw = prfOutput instanceof Uint8Array ? prfOutput : new Uint8Array(prfOutput)
    const tag = enc().encode(domain + ":")
    const buf = new Uint8Array(tag.length + raw.length)
    buf.set(tag, 0)
    buf.set(raw, tag.length)
    return sha256Hex(buf)
}

/**
 * Derive the ZEN keypair for a PRF output — deterministic: the same credential
 * yields the same identity, no storage.
 * @param {ArrayBuffer|Uint8Array} prfOutput
 * @param {{pair: Function}} ZEN - the ZEN module (injected so this stays isomorphic/testable)
 * @param {string} [domain]
 * @returns {Promise<{pub: string, priv: string}>}
 */
export async function identityFromPRF(prfOutput, ZEN, domain) {
    const seed = await prfSeed(prfOutput, domain)
    return ZEN.pair(null, { seed })
}

// ─── the interactive ceremony (needs a real/virtual authenticator) ─────────────

const b64urlToBytes = (s) => {
    const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : ""
    const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad)
    return Uint8Array.from(b, (c) => c.charCodeAt(0))
}
const randomChallenge = () => globalThis.crypto.getRandomValues(new Uint8Array(32))

/**
 * Register a new PRF-capable credential (WebAuthn create). Returns the
 * credential id (raw bytes) to store for later logins. Browser-only.
 */
export async function registerCredential({ rpId, rpName = "Nexus", userId, userName, challenge } = {}) {
    if (typeof navigator === "undefined" || !navigator.credentials) throw new Error("E_NO_WEBAUTHN")
    const credential = await navigator.credentials.create({
        publicKey: {
            challenge: challenge ?? randomChallenge(),
            rp: { id: rpId, name: rpName },
            user: { id: userId ?? randomChallenge(), name: userName, displayName: userName },
            pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
            authenticatorSelection: { residentKey: "required", userVerification: "preferred" },
            extensions: { prf: {} }
        }
    })
    return new Uint8Array(credential.rawId)
}

/**
 * Run the PRF ceremony (WebAuthn get) and derive the ZEN identity. Reading the
 * PRF output requires a real authenticator — this is the interactive step.
 * @returns {Promise<{pub: string, priv: string}>}
 */
export async function loginIdentity({ rpId, credentialId, challenge, salt = "nexus" }, ZEN) {
    if (typeof navigator === "undefined" || !navigator.credentials) throw new Error("E_NO_WEBAUTHN")
    const assertion = await navigator.credentials.get({
        publicKey: {
            challenge: challenge ?? randomChallenge(),
            rpId,
            allowCredentials: credentialId ? [{ type: "public-key", id: credentialId }] : [],
            userVerification: "preferred",
            extensions: { prf: { eval: { first: enc().encode(salt) } } }
        }
    })
    const prf = assertion.getClientExtensionResults?.().prf
    if (!prf?.results?.first) throw new Error("E_NO_PRF: authenticator did not return a PRF result")
    return identityFromPRF(prf.results.first, ZEN)
}

export default { prfSeed, identityFromPRF, registerCredential, loginIdentity, b64urlToBytes }
