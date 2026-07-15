/**
 * ULID — 26-character, Crockford base32, time-sortable row identifier.
 * Client-generated per docs/sync-design.md §2 (no central allocation point);
 * matches the DDL decision (id text PK, varchar(26) on mysql).
 * 48-bit millisecond time (10 chars) + 80-bit randomness (16 chars).
 */

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"

/**
 * @param {number} [time] - Milliseconds since epoch (injectable for tests)
 * @returns {string} 26-character ULID
 */
export function ulid(time = Date.now()) {
    let t = time
    let out = ""
    for (let i = 0; i < 10; i++) {
        out = CROCKFORD[t % 32] + out
        t = Math.floor(t / 32)
    }
    for (let i = 0; i < 16; i++) out += CROCKFORD[Math.floor(Math.random() * 32)]
    return out
}

export default ulid
