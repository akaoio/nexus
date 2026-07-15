/**
 * The Kysely boundary — the ONLY sanctioned import path for vendored Kysely
 * (ARCHITECTURE.md N2: vendored deps live behind an internal interface; the
 * AST compiler is the only consumer). Nothing outside src/data/ may import
 * vendor/kysely directly — VND-02 enforces this statically.
 *
 * createCompiler(dialect) returns a Kysely instance wired to DummyDriver:
 * full dialect-aware SQL GENERATION with zero drivers and zero connections —
 * exactly the seam the Query AST compiler targets. Execution wiring (real
 * drivers per engine) arrives with the adapter layer.
 *
 * Turso is SQLite-compatible at the SQL dialect level (ARCHITECTURE §4.5),
 * so it shares the sqlite compiler; its own driver arrives with adapters.
 */

import {
    Kysely,
    sql,
    DummyDriver,
    SqliteAdapter,
    SqliteQueryCompiler,
    SqliteIntrospector,
    PostgresAdapter,
    PostgresQueryCompiler,
    PostgresIntrospector,
    MysqlAdapter,
    MysqlQueryCompiler,
    MysqlIntrospector
} from "../../vendor/kysely/index.js"

const DIALECTS = {
    sqlite: { Adapter: SqliteAdapter, QueryCompiler: SqliteQueryCompiler, Introspector: SqliteIntrospector },
    turso: { Adapter: SqliteAdapter, QueryCompiler: SqliteQueryCompiler, Introspector: SqliteIntrospector },
    postgres: { Adapter: PostgresAdapter, QueryCompiler: PostgresQueryCompiler, Introspector: PostgresIntrospector },
    mysql: { Adapter: MysqlAdapter, QueryCompiler: MysqlQueryCompiler, Introspector: MysqlIntrospector }
}

/** The engine names the data plane recognizes. */
export const DIALECT_NAMES = Object.freeze(Object.keys(DIALECTS))

/**
 * A compile-only Kysely instance for a dialect: generates SQL + bindings,
 * never connects, never executes.
 * @param {"sqlite"|"turso"|"postgres"|"mysql"} dialect
 * @returns {Kysely}
 */
export function createCompiler(dialect = "sqlite") {
    const d = DIALECTS[dialect]
    if (!d) throw new Error(`E_DIALECT: unknown dialect "${dialect}" (known: ${DIALECT_NAMES.join(", ")})`)
    return new Kysely({
        dialect: {
            createAdapter: () => new d.Adapter(),
            createDriver: () => new DummyDriver(),
            createQueryCompiler: () => new d.QueryCompiler(),
            createIntrospector: (db) => new d.Introspector(db)
        }
    })
}

export { Kysely, sql, DummyDriver }
