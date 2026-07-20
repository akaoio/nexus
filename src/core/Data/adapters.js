/**
 * Engine capability & dialect declarations — the BROWSER-SAFE tier of the Data
 * core (ARCHITECTURE.md §3 "Adapter: Kysely dialects + capabilities", §4.6a).
 * This is pure declarative data with ZERO Node dependency: engine names, the
 * engine→dialect map, and the capability matrix the Migration Engine asks
 * instead of hardcoding. It is statically importable from a browser graph —
 * migrate.js imports capabilitiesFor from here, and the Studio schema designer
 * imports migrate.js, so a single Node built-in reintroduced here would poison
 * the whole built Studio (a browser cannot resolve `import … from "module"`).
 * VND-07 pins this boundary structurally.
 *
 * Real driver EXECUTION lives in the sibling ./executor.js, behind the boundary
 * — the same discipline as ./kysely.js for vendored Kysely (VND-02). Drivers
 * remain the USER'S choice (N2): never vendored, never a dependency of Nexus;
 * they are resolved from the instance and loaded there, on the server only.
 *
 * Engine → dialect → placeholders (matching the Kysely dialect compilers):
 *   sqlite    node:sqlite (built-in)           ?   (file or :memory:)
 *   turso     @tursodatabase/database          ?   (better-sqlite3-like, async)
 *   postgres  pg (Pool)                        $1
 *   mysql     mysql2/promise (Pool)            ?
 */

export const ENGINES = Object.freeze(["sqlite", "turso", "postgres", "mysql"])

/** Shared error helper — a bare `code` or `code: detail`. Imported by the
 *  server-only executor so both tiers raise the same E_ENGINE/E_DRIVER/E_VEC. */
export const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

/** Every engine name is also its Kysely dialect name. */
export const engineDialect = (engine) => engine

/**
 * Engine capabilities (ARCHITECTURE.md §3 "Adapter: Kysely dialects +
 * capabilities", §4.6a's capability matrix) — declared, never assumed. The
 * migration engine asks instead of hardcoding dialect names, and an engine
 * added without a record fails closed rather than inheriting "yes".
 *
 * transactionalDDL: can DDL run inside a transaction and be rolled back?
 *   MySQL implicitly COMMITs on DDL, so its dry run would destroy the very
 *   table it was asked to measure (issue #9 C5).
 */
export const CAPABILITIES = Object.freeze({
    sqlite: Object.freeze({ transactionalDDL: true, vector: "sqlite-vec", fts: "fts5" }),
    turso: Object.freeze({ transactionalDDL: true, vector: "native", fts: "experimental" }),
    postgres: Object.freeze({ transactionalDDL: true, vector: "pgvector", fts: "tsvector" }),
    mysql: Object.freeze({ transactionalDDL: false, vector: "none", fts: "fulltext" })
})

/** Capabilities for an engine; unknown engines throw rather than defaulting. */
export function capabilitiesFor(engine) {
    const caps = CAPABILITIES[engine]
    if (!caps) throw err("E_ENGINE", `unknown engine "${engine}" (known: ${ENGINES.join(", ")})`)
    return caps
}

export default { ENGINES, engineDialect, CAPABILITIES, capabilitiesFor }
