/**
 * Engine executor — the SERVER-ONLY tier that turns an engine name into a real
 * connection behind the minimal executor contract { run(sql, params),
 * all(sql, params), close() } that the Migration Engine and Data Plane speak
 * (ARCHITECTURE.md §4.5). This is the execution counterpart to the browser-safe
 * ./adapters.js: capability/dialect DECLARATION lives there; real DRIVERS live
 * here, behind the boundary (the same discipline as ./kysely.js for vendored
 * Kysely, VND-02). Because it statically imports Node built-ins (module/url/path)
 * and loads native drivers, this module must NEVER enter a browser module graph
 * — VND-07 pins that adapters.js and its importers (migrate.js → the Studio
 * schema designer) stay clean, and that only executor.js may reach for Node.
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
import { ENGINES, err } from "./adapters.js"

const INSTALL = {
    turso: "npm install @tursodatabase/database",
    postgres: "npm install pg",
    mysql: "npm install mysql2"
}

/**
 * The ONE place transaction control flow lives (TXN-01/03/05). Every engine
 * supplies an `acquire()` returning `{ run, all, release? }`; this decides
 * begin/commit/rollback identically for all of them.
 *
 * Two rules worth stating because getting either wrong is silent:
 *
 *  - **One connection for the whole callback.** `acquire()` is called ONCE.
 *    On a pooled driver that means checking a client out and running
 *    everything on it — `pool.query()` per statement hands out an arbitrary
 *    idle client, so BEGIN, the body and COMMIT would land on different
 *    connections and the transaction would be a no-op (TXN-02). That is
 *    precisely how the pre-seam `run("BEGIN")` improvisation was unsound on
 *    pg/mysql2 while looking correct on sqlite and PGlite.
 *  - **A failed rollback never replaces the error that caused it.** The
 *    caller must be told why its work failed, not that cleanup also failed;
 *    the rollback failure is appended, never substituted (TXN-05).
 *
 * No nesting in v1: the `tx` handed to the callback refuses `transaction()`
 * with E_NESTED_TX. Savepoint syntax differs per engine, and silently
 * flattening a nested call would produce a transaction that commits half-way.
 */
export async function runTransaction({ acquire, begin = "BEGIN" }, fn) {
    const conn = await acquire()
    const tx = {
        run: (sql, params = []) => conn.run(sql, params),
        all: (sql, params = []) => conn.all(sql, params),
        transaction() { throw err("E_NESTED_TX", "transactions do not nest in v1 — savepoints are engine-specific") }
    }
    try {
        await conn.run(begin, [])
        const result = await fn(tx)
        await conn.run("COMMIT", [])
        return result
    } catch (error) {
        try {
            await conn.run("ROLLBACK", [])
        } catch (rollbackError) {
            error.message = `${error.message} (rollback also failed: ${rollbackError.message})`
        }
        throw error
    } finally {
        conn.release?.()
    }
}

/** A single handle (node:sqlite, Turso, PGlite) IS the connection — nothing to check out. */
const acquireHandle = (run, all) => async () => ({ run, all })

/** `pg`: check a client out of the pool for the whole transaction, release it once. */
export const acquirePg = (pool) => async () => {
    const client = await pool.connect()
    return {
        run: async (sql, params = []) => void (await client.query(sql, params)),
        all: async (sql, params = []) => (await client.query(sql, params)).rows,
        release: () => client.release()
    }
}

/** `mysql2`: same guarantee, different check-out verb. */
export const acquireMysql = (pool) => async () => {
    const conn = await pool.getConnection()
    return {
        run: async (sql, params = []) => void (await conn.query(sql, params)),
        all: async (sql, params = []) => (await conn.query(sql, params))[0],
        release: () => conn.release()
    }
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
        const run = (sql, params = []) => void db.prepare(sql).run(...params)
        const all = (sql, params = []) => db.prepare(sql).all(...params)
        return {
            engine,
            dialect: "sqlite",
            vec,
            run,
            all,
            // BEGIN IMMEDIATE, not bare BEGIN: SQLite's default DEFERRED
            // transaction takes its write lock at the first WRITE, so a
            // read-then-write transaction — which is exactly what the Data
            // Plane's update/remove are — can have another writer slip in
            // between. A deferred transaction is not a TOCTOU fix (TXN-04).
            transaction: (fn) => runTransaction({ acquire: acquireHandle(run, all), begin: "BEGIN IMMEDIATE" }, fn),
            close: () => db.close()
        }
    }

    if (engine === "turso") {
        const mod = await importDriver("@tursodatabase/database", engine, config.root)
        const Database = mod.default ?? mod.Database
        const db = new Database(config.path ?? ":memory:")
        if (typeof db.connect === "function") await db.connect()
        const run = async (sql, params = []) => void (await db.prepare(sql).run(...params))
        const all = async (sql, params = []) => db.prepare(sql).all(...params)
        return {
            engine,
            dialect: "turso",
            run,
            all,
            // Same SQL dialect as sqlite, so the same up-front write lock.
            transaction: (fn) => runTransaction({ acquire: acquireHandle(run, all), begin: "BEGIN IMMEDIATE" }, fn),
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
            const run = async (sql, params = []) => void (await db.query(sql, params))
            const all = async (sql, params = []) => (await db.query(sql, params)).rows
            return {
                engine,
                dialect: "postgres",
                run,
                all,
                // PGlite is ONE in-process instance — it is its own connection.
                transaction: (fn) => runTransaction({ acquire: acquireHandle(run, all) }, fn),
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
            // A POOL is where per-statement checkout would silently break the
            // transaction — acquirePg holds one client for the whole callback.
            transaction: (fn) => runTransaction({ acquire: acquirePg(pool) }, fn),
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
        // DML transactions work on MySQL; DDL ones do not (it implicitly
        // COMMITs) — that stays a separate, narrower claim, CAPABILITIES
        // .transactionalDDL, and the migration path still refuses on it (C5).
        transaction: (fn) => runTransaction({ acquire: acquireMysql(pool) }, fn),
        close: () => pool.end()
    }
}

export default { createExecutor, runTransaction, acquirePg, acquireMysql }
