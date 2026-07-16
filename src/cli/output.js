/**
 * CLI output layer — zero dependencies (ARCHITECTURE.md §5.2 rule 2).
 *
 * Two modes, decided once per invocation:
 *  - text: colored + styled when stdout is a TTY; plain when piped (rule 3).
 *  - --json: exactly one JSON document on stdout, shape versioned with
 *    jsonVersion — a public contract under App API v1 (rule 3).
 */

export const JSON_VERSION = 1

/**
 * Constant-time string equality for secrets (API keys) — SEC-06. Compares in
 * time independent of WHERE the first difference is, so an attacker cannot
 * recover a key byte-by-byte via timing. A length mismatch returns false
 * without leaking beyond length (acceptable for high-entropy random keys).
 */
export function timingSafeStringEqual(a, b) {
    if (typeof a !== "string" || typeof b !== "string") return false
    if (a.length !== b.length) return false
    let diff = 0
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
    return diff === 0
}

export function createOutput(flags = {}) {
    const json = flags.json === true
    const tty = !!process.stdout.isTTY && !json
    const paint = (code) => (s) => (tty ? `\x1b[${code}m${s}\x1b[0m` : String(s))

    const out = {
        json,
        bold: paint(1),
        dim: paint(2),
        red: paint(31),
        green: paint(32),
        yellow: paint(33),
        cyan: paint(36),

        /** Human-facing line — silenced in --json mode. */
        print(text = "") {
            if (!json) console.log(text)
        },

        /** The single machine-readable document — only in --json mode. */
        emit(data) {
            if (json) console.log(JSON.stringify({ jsonVersion: JSON_VERSION, ...data }))
        },

        error(message, extra = {}) {
            if (json) console.log(JSON.stringify({ jsonVersion: JSON_VERSION, ok: false, error: message, ...extra }))
            else console.error(out.red(`✗ ${message}`))
        },

        hint(text) {
            if (!json) console.error(out.dim(text))
        }
    }
    return out
}
