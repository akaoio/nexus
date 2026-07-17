/**
 * Users = identities (ARCHITECTURE.md §342: "Định danh user = ZEN keypair,
 * derive từ WebAuthn passkey"; §195: policies attach to a role or a user).
 * A user is a ZEN public key with roles; there is no password to store. The
 * site's `identities` list ([{ pub, name?, roles }]) is the roster — the same
 * list the auth layer already reads to map a signed-in key to its policies.
 *
 * Pure operations over that array (no I/O) so the CLI, the dev endpoints and
 * tests all share one source of truth. Configuring any identity makes auth
 * REQUIRED (instance-server.js) — there is no "some users, open to all" state.
 */

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

/** The site's identities, always an array. */
export function listUsers(config) {
    return Array.isArray(config?.identities) ? config.identities : []
}

/** Add an identity. Throws E_PUB (bad key) or E_EXISTS (already a user). */
export function addUser(identities, { pub, name, roles = [] } = {}) {
    if (typeof pub !== "string" || !pub.trim()) throw err("E_PUB", "a public key is required")
    if (identities.some((i) => i.pub === pub)) throw err("E_EXISTS", `identity ${pub.slice(0, 12)}… already exists`)
    if (!Array.isArray(roles)) throw err("E_ROLES", "roles must be an array")
    const entry = { pub, roles: [...new Set(roles)] }
    if (name) entry.name = String(name)
    return [...identities, entry]
}

/** Remove an identity by public key (no-op if absent). */
export function removeUser(identities, pub) {
    return identities.filter((i) => i.pub !== pub)
}

/** Replace an identity's roles. Throws E_NOT_FOUND if the key is unknown. */
export function setRoles(identities, pub, roles) {
    if (!identities.some((i) => i.pub === pub)) throw err("E_NOT_FOUND", `no identity ${pub.slice(0, 12)}…`)
    if (!Array.isArray(roles)) throw err("E_ROLES", "roles must be an array")
    return identities.map((i) => (i.pub === pub ? { ...i, roles: [...new Set(roles)] } : i))
}

/** A short, human-friendly label for an identity (name or truncated key). */
export function labelOf(identity) {
    return identity?.name || (identity?.pub ? identity.pub.slice(0, 10) + "…" + identity.pub.slice(-4) : "unknown")
}

export default { listUsers, addUser, removeUser, setRoles, labelOf }
