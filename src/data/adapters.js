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

export default { ENGINES, engineDialect, createExecutor }
