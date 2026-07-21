/**
 * Transaction control flow — the BROWSER-SAFE tier of the transaction seam
 * (issue #9 chunk 2, §1 of the durability design). Same split as
 * adapters.js/executor.js one layer down: the *decision* about begin/commit/
 * rollback is pure logic and lives here; the real *connections* it drives live
 * in the server-only executor.js. Zero Node dependency, so the Data Plane and
 * the Migration Engine — both reachable from a browser module graph — can
 * compose a transaction without pulling drivers in behind them (VND-07).
 *
 * The rule that makes this worth being a module rather than three inline
 * try/catches: ONE connection for the whole callback. `acquire()` is called
 * exactly once. On a pooled driver that means checking a client out and
 * running everything on it — `pool.query()` per statement hands out an
 * arbitrary idle client, so BEGIN, the body and COMMIT would land on
 * different connections: the BEGIN opens a transaction nobody commits, the
 * body runs outside any transaction, and the ROLLBACK rolls back nothing.
 * That is exactly how the pre-seam `run("BEGIN")` improvisation was unsound
 * on pg/mysql2 while looking correct on sqlite and PGlite (TXN-02).
 */

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

/**
 * Run `fn` inside one transaction on one connection.
 *
 * Commits on return, rolls back on throw, and re-throws the ORIGINAL error —
 * a failed rollback is appended to its message, never substituted for it
 * (TXN-05). The caller must be told why its work failed, not that cleanup
 * also failed.
 *
 * No nesting in v1: the `tx` handed to the callback refuses `transaction()`
 * with E_NESTED_TX. Savepoint syntax differs per engine, and silently
 * flattening a nested call would produce a transaction that commits half-way.
 *
 * @param {{acquire: Function, begin?: string}} options
 * @param {(tx: {run: Function, all: Function}) => Promise<any>} fn
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
export const acquireHandle = (run, all) => async () => ({ run, all })

/**
 * Compose a `transaction(fn)` over a bare `{ run, all }` pair. Correct for any
 * executor backed by ONE connection — which every hand-rolled executor is, and
 * which `createExecutor` guarantees for sqlite/turso/PGlite. A caller that
 * hand-rolls a POOL wrapper and hands it here gets the unsound behaviour
 * described in the module header; that is why the real pooled drivers supply
 * their own `transaction` instead of relying on this.
 */
export const handleTransaction = (run, all, begin) => (fn) =>
    runTransaction({ acquire: acquireHandle(run, all), begin }, fn)

/**
 * The transaction function for an executor: its own when it has one, else one
 * composed over its `run`/`all`.
 *
 * The fallback exists for N3, not for convenience. `transaction` joined the
 * executor contract after apps, the CLI and the test suite had already been
 * handing the engine hand-rolled `{ run, all }` pairs; refusing those outright
 * would break working code for a capability they can be given instead. Every
 * such executor is single-connection, which is exactly the case the fallback
 * is correct for.
 *
 * What the fallback does NOT give you: the up-front write lock
 * (`BEGIN IMMEDIATE`) that closes the read-then-write window on sqlite, and
 * any guarantee at all if the caller hand-rolled a POOL wrapper — see the
 * module header for why that case is unsound. Both are reasons to obtain
 * executors from `createExecutor`, which always supplies a real one.
 */
export const transactionOf = (executor, begin) =>
    executor.transaction?.bind(executor) ??
    handleTransaction((sql, params) => executor.run(sql, params), (sql, params) => executor.all(sql, params), begin)

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

export default { runTransaction, acquireHandle, handleTransaction, transactionOf, acquirePg, acquireMysql }
