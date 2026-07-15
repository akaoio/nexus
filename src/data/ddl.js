/**
 * Model Schema → DDL compiler — an Entity becomes CREATE TABLE + indexes,
 * per dialect, through the Kysely schema builder (ARCHITECTURE.md §4.1/§4.4).
 *
 * Spec decisions encoded here (and pinned by DDL-* clauses):
 *  - Every entity table carries the system columns: id (ULID string,
 *    PRIMARY KEY — client-generated per docs/sync-design.md §2, identical in
 *    both runtimes), owner (ZEN pub key), created_at, updated_at.
 *  - `table` fields produce NO column — the child entity holds the parent
 *    link; the field exists at the schema/UI level only.
 *  - `select` options are NOT a CHECK constraint: extending options is an
 *    additive change (MS-D09) and must stay hot-DDL-safe; SQLite would need
 *    a table rebuild to alter a CHECK. Option enforcement lives in the Data
 *    Plane validation layer.
 *  - `link` fields are plain indexed columns — NO database-level foreign
 *    keys. This is design, not laziness: CRDT sync folds events out of
 *    order (update-before-create is legal, docs/sync-design.md §4.2), which
 *    DB-enforced FKs would reject. Referential integrity is the Data
 *    Plane's job; `sync: authoritative` entities may opt into FKs later.
 *  - Dialect type map below; sqlite stores boolean as integer and
 *    date/datetime as ISO text (string order ≡ chronological for ISO —
 *    the same ordering semantics the AST predicate pins).
 */

import { validate } from "../model/Model.js"
import { DIALECT_NAMES } from "./kysely.js"

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

// dialect family: turso shares sqlite's storage model
const family = (dialect) => (dialect === "turso" ? "sqlite" : dialect)

const TYPES = {
    text: { sqlite: "text", postgres: "text", mysql: "varchar(255)" },
    integer: { sqlite: "integer", postgres: "integer", mysql: "integer" },
    number: { sqlite: "real", postgres: "double precision", mysql: "double precision" },
    boolean: { sqlite: "integer", postgres: "boolean", mysql: "boolean" },
    date: { sqlite: "text", postgres: "date", mysql: "date" },
    datetime: { sqlite: "text", postgres: "timestamptz", mysql: "datetime(3)" },
    select: { sqlite: "text", postgres: "text", mysql: "varchar(255)" },
    link: { sqlite: "text", postgres: "text", mysql: "varchar(26)" }, // ULID references
    file: { sqlite: "text", postgres: "text", mysql: "varchar(255)" } // content address
}

const SYSTEM = {
    id: { sqlite: "text", postgres: "text", mysql: "varchar(26)" }, // ULID
    owner: { sqlite: "text", postgres: "text", mysql: "varchar(64)" }, // ZEN pub key
    created_at: TYPES.datetime,
    updated_at: TYPES.datetime
}

/** The column data type for a field type on a dialect (E_DIALECT/E_TYPE loudly). */
export function columnType(fieldType, dialect = "sqlite") {
    if (!DIALECT_NAMES.includes(dialect)) throw err("E_DIALECT", `unknown dialect "${dialect}"`)
    const entry = TYPES[fieldType]
    if (!entry) throw err("E_TYPE", `no column mapping for field type "${fieldType}"`)
    return entry[family(dialect)]
}

/**
 * Compile an Entity schema into DDL builders: one CREATE TABLE followed by
 * CREATE INDEX builders (declared indexes + one per link field). Builders
 * compile or execute against the Kysely instance's own dialect; pass the
 * matching `dialect` for the type map.
 *
 * @param {*} db - Kysely instance (compile-only or live)
 * @param {Object} schema - Valid Model Schema v1 document
 * @param {Object} [options] - { dialect = "sqlite", ifNotExists = false }
 * @returns {Array} Kysely schema builders, execution-ordered
 */
export function tableDDL(db, schema, options = {}) {
    const dialect = options.dialect ?? "sqlite"
    if (!DIALECT_NAMES.includes(dialect)) throw err("E_DIALECT", `unknown dialect "${dialect}"`)
    const result = validate(schema)
    if (!result.valid) throw err("E_INVALID", JSON.stringify(result.errors))

    const table = schema.name
    let create = db.schema.createTable(table)
    if (options.ifNotExists) create = create.ifNotExists()

    // System columns — identical on every entity, both runtimes
    create = create
        .addColumn("id", SYSTEM.id[family(dialect)], (col) => col.primaryKey().notNull())
        .addColumn("owner", SYSTEM.owner[family(dialect)])
        .addColumn("created_at", SYSTEM.created_at[family(dialect)])
        .addColumn("updated_at", SYSTEM.updated_at[family(dialect)])

    for (const field of schema.fields) {
        if (field.type === "table") continue // child entity holds the parent link
        create = create.addColumn(field.name, columnType(field.type, dialect), (col) => {
            if (field.required === true) col = col.notNull()
            if (field.unique === true) col = col.unique()
            if ("default" in field) col = col.defaultTo(field.default)
            return col
        })
    }

    // Indexes: declared ones first, then an automatic index per link field
    const builders = [create]
    const named = new Set()
    for (const index of schema.indexes ?? []) {
        const name = `idx_${table}_${index.fields.join("_")}`
        if (named.has(name)) continue
        named.add(name)
        builders.push(db.schema.createIndex(name).on(table).columns(index.fields))
    }
    for (const field of schema.fields) {
        if (field.type !== "link") continue
        const name = `idx_${table}_${field.name}`
        if (named.has(name)) continue
        named.add(name)
        builders.push(db.schema.createIndex(name).on(table).column(field.name))
    }

    return builders
}

export default { tableDDL, columnType }
