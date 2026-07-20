/**
 * Engine adapters — real drivers behind the minimal executor contract
 * { run(sql, params), all(sql, params), close() } that the Migration Engine
 * and Data Plane already speak (ARCHITECTURE.md §4.5).
 *
 * Drivers are the USER'S choice (N2): never vendored, never a dependency of
 * Nexus. The default engine needs no install at all — node:sqlite ships
 * inside Node ≥22. Other engines resolve their driver dynamically from the
 * INSTANCE's node_modules; a missing driver fails loudly with the exact
 * install command (E_DRIVER), never a cryptic module error.
 *
 * Engine → driver → placeholders (matching the Kysely dialect compilers):
 *   sqlite    node:sqlite (built-in)           ?   (file or :memory:)
 *   turso     @tursodatabase/database          ?   (better-sqlite3-like, async)
 *   postgres  pg (Pool)                        $1
 *   mysql     mysql2/promise (Pool)            ?
 *
 * Honesty note: the sqlite adapter is pinned here against the real engine;
 * turso/postgres/mysql adapters follow their drivers' published APIs and are
 * pinned live in the multi-engine CI matrix (real services required) — this
 * environment verifies their contract shape and E_DRIVER paths.
 */

import { createRequire } from "module"
import { pathToFileURL } from "url"
import { join } from "path"

export const ENGINES = Object.freeze(["sqlite", "turso", "postgres", "mysql"])

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

const INSTALL = {
    turso: "npm install @tursodatabase/database",
    postgres: "npm install pg",
    mysql: "npm install mysql2"
}

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

async function importDriver(name, engine, root) {
    try {
        return await import(name)
    } catch {}
    try {
        const require = createRequire(join(root ?? process.cwd(), "package.json"))
        return await import(pathToFileURL(require.resolve(name)).href)
    } catch {}
    throw err("E_DRIVER", `the "${engine}" engine needs its driver — run: ${INSTALL[engine]}`)
}

/**
 * Open an executor for an engine.
 * @param {"sqlite"|"turso"|"postgres"|"mysql"} engine
 * @param {Object} [config] - Engine connection config:
 *   sqlite/turso: { path = ":memory:" } · postgres: { connectionString | host… }
 *   mysql: { host, user, … } · all: { root } — instance dir for driver resolution
 * @returns {Promise<{engine, dialect, run, all, close}>}
 */
export async function createExecutor(engine = "sqlite", config = {}) {
    if (!ENGINES.includes(engine)) throw err("E_ENGINE", `unknown engine "${engine}" (known: ${ENGINES.join(", ")})`)

    if (engine === "sqlite") {
        const { DatabaseSync } = await import("node:sqlite")
        // config.vec loads the sqlite-vec extension (real ANN) — resolved
        // from the instance like any driver; vec becomes false if unavailable.
        const db = new DatabaseSync(config.path ?? ":memory:", config.vec ? { allowExtension: true } : {})
        let vec = false
        if (config.vec)
            try {
                const mod = await importDriver("sqlite-vec", "sqlite", config.root)
                ;(mod.default ?? mod).load(db)
                vec = true
            } catch (error) {
                if (config.vec === "require") throw err("E_VEC", `sqlite-vec required but unavailable: ${error.message}`)
            }
        return {
            engine,
            dialect: "sqlite",
            vec,
            run: (sql, params = []) => void db.prepare(sql).run(...params),
            all: (sql, params = []) => db.prepare(sql).all(...params),
            close: () => db.close()
        }
    }

    if (engine === "turso") {
        const mod = await importDriver("@tursodatabase/database", engine, config.root)
        const Database = mod.default ?? mod.Database
        const db = new Database(config.path ?? ":memory:")
        if (typeof db.connect === "function") await db.connect()
        return {
            engine,
            dialect: "turso",
            run: async (sql, params = []) => void (await db.prepare(sql).run(...params)),
            all: async (sql, params = []) => db.prepare(sql).all(...params),
            close: () => db.close()
        }
    }

    if (engine === "postgres") {
        // Two real drivers behind ONE dialect. PGlite (@electric-sql/pglite) is
        // real Postgres compiled to WASM, in-process, no server — so the
        // postgres path is provable on any machine, exactly like Turso is for
        // sqlite. pg drives a live cluster in the CI matrix. Same SQL, same
        // $1 placeholders, same executor contract — the app never knows which.
        if (config.pglite || config.driver === "pglite") {
            let mod
            try {
                mod = await import("@electric-sql/pglite")
            } catch {
                try {
                    const require = createRequire(join(config.root ?? process.cwd(), "package.json"))
                    mod = await import(pathToFileURL(require.resolve("@electric-sql/pglite")).href)
                } catch {
                    throw err("E_DRIVER", `the in-process postgres driver is missing — run: npm install @electric-sql/pglite`)
                }
            }
            const PGlite = mod.PGlite ?? mod.default?.PGlite ?? mod.default
            const db = new PGlite(config.path)
            return {
                engine,
                dialect: "postgres",
                run: async (sql, params = []) => void (await db.query(sql, params)),
                all: async (sql, params = []) => (await db.query(sql, params)).rows,
                close: () => db.close()
            }
        }
        const mod = await importDriver("pg", engine, config.root)
        const Pool = mod.default?.Pool ?? mod.Pool
        const pool = new Pool(config)
        return {
            engine,
            dialect: "postgres",
            run: async (sql, params = []) => void (await pool.query(sql, params)),
            all: async (sql, params = []) => (await pool.query(sql, params)).rows,
            close: () => pool.end()
        }
    }

    // mysql
    const mod = await importDriver("mysql2/promise", engine, config.root)
    const createPool = mod.default?.createPool ?? mod.createPool
    const pool = createPool(config)
    return {
        engine,
        dialect: "mysql",
        run: async (sql, params = []) => void (await pool.query(sql, params)),
        all: async (sql, params = []) => (await pool.query(sql, params))[0],
        close: () => pool.end()
    }
}

export default { ENGINES, engineDialect, CAPABILITIES, capabilitiesFor, createExecutor }
