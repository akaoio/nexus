/**
 * WebAuthn passkey lock — the akao core/WebAuthn.js essentials applied to
 * the Studio's real auth: after a passphrase sign-in the ZEN keypair can be
 * LOCKED TO THIS DEVICE — a passkey is created with the PRF extension, its
 * deterministic secret becomes an AES-GCM key, and the pair is stored only
 * ENCRYPTED (IndexedDB). Unlocking asserts the passkey (biometric/PIN),
 * re-derives the same secret and decrypts — no plaintext key at rest, no
 * secret on any server. Degrades honestly: no authenticator → no offer.
 */

import { cached, remember } from "./cache.js"

const SALT = new TextEncoder().encode("nexus-studio-pair")
const STORE = "passkey:pair"

export const passkeySupported = () =>
    typeof PublicKeyCredential !== "undefined" && typeof crypto?.subtle !== "undefined"

async function aesKey(prfSecret) {
    return crypto.subtle.importKey("raw", prfSecret, "AES-GCM", false, ["encrypt", "decrypt"])
}

/** Create the passkey and store the ENCRYPTED pair. Returns true on success. */
export async function enroll(pair, label = "Nexus Studio") {
    const credential = await navigator.credentials.create({
        publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rp: { id: location.hostname, name: label },
            user: {
                id: crypto.getRandomValues(new Uint8Array(32)),
                name: pair.pub.slice(0, 16),
                displayName: label
            },
            pubKeyCredParams: [
                { type: "public-key", alg: -7 },
                { type: "public-key", alg: -257 }
            ],
            authenticatorSelection: { userVerification: "preferred", residentKey: "required", requireResidentKey: true },
            attestation: "none",
            timeout: 60000,
            extensions: { prf: { eval: { first: SALT } } }
        }
    })
    let secret = credential.getClientExtensionResults()?.prf?.results?.first
    if (!secret) {
        // some authenticators only evaluate PRF on assertion — assert once now
        secret = await assertSecret(credential.rawId)
    }
    if (!secret) return false // authenticator without PRF — refuse silently
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const blob = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(secret), new TextEncoder().encode(JSON.stringify(pair)))
    await remember(STORE, { credId: Array.from(new Uint8Array(credential.rawId)), iv: Array.from(iv), blob: Array.from(new Uint8Array(blob)) })
    return true
}

async function assertSecret(rawId) {
    const assertion = await navigator.credentials.get({
        publicKey: {
            challenge: crypto.getRandomValues(new Uint8Array(32)),
            rpId: location.hostname,
            allowCredentials: rawId ? [{ type: "public-key", id: rawId }] : [],
            userVerification: "preferred",
            timeout: 60000,
            extensions: { prf: { eval: { first: SALT } } }
        }
    })
    return assertion.getClientExtensionResults()?.prf?.results?.first ?? null
}

/** Is a locked pair stored on this device? */
export async function enrolled() {
    return !!(await cached(STORE))
}

/** Assert the passkey and decrypt the pair. Returns the pair or null. */
export async function unlock() {
    const stored = await cached(STORE)
    if (!stored) return null
    const secret = await assertSecret(new Uint8Array(stored.credId).buffer)
    if (!secret) return null
    try {
        const plain = await crypto.subtle.decrypt(
            { name: "AES-GCM", iv: new Uint8Array(stored.iv) },
            await aesKey(secret),
            new Uint8Array(stored.blob)
        )
        return JSON.parse(new TextDecoder().decode(plain))
    } catch {
        return null // wrong passkey or tampered blob — never a partial result
    }
}

export default { passkeySupported, enroll, enrolled, unlock }
