/**
 * Instance data helpers shared by dev/migrate/site/doctor: open the
 * configured engine (nexus.config.json → database, default sqlite at
 * .nexus/data.db) and ensure entity tables exist.
 */

import { mkdirSync } from "fs"
import { join } from "path"
import { createExecutor } from "../core/Data/adapters.js"
import { createCompiler } from "../core/Data/kysely.js"
import { tableDDL } from "../core/Data/ddl.js"

export async function openInstanceData(root, config) {
    const database = config.database ?? {}
    const engine = database.engine ?? "sqlite"
    const connection = { ...database, root }
    delete connection.engine
    if (engine === "sqlite" && !connection.path) {
        mkdirSync(join(root, ".nexus"), { recursive: true })
        connection.path = join(root, ".nexus", "data.db")
    }
    const executor = await createExecutor(engine, connection)
    return { executor, kysely: createCompiler(executor.dialect), dialect: executor.dialect, engine }
}

export async function ensureTables(executor, kysely, schemas, dialect) {
    for (const schema of schemas)
        for (const builder of tableDDL(kysely, schema, { dialect, ifNotExists: true })) {
            const compiled = builder.compile()
            await executor.run(compiled.sql, [...compiled.parameters])
        }
}
