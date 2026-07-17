/**
 * Data Plane conformance — VENDORED KYSELY (VND-*).
 *
 * Pins the vendoring contract of ARCHITECTURE.md N2 + risk #4: the pin
 * manifest matches reality, the boundary module is the only import path
 * (enforced statically), and compile-only SQL generation works per dialect
 * with zero drivers — the seam the AST compiler will target.
 */

import { fileURLToPath } from "url"
import { readFileSync, readdirSync, statSync } from "fs"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { createCompiler, DIALECT_NAMES } from "../../src/core/Data/kysely.js"

const ROOT = fileURLToPath(new URL("../..", import.meta.url))

Test.describe("Data Plane — vendored Kysely (VND-*)", () => {
    Test.it("VND-01 the VENDOR.json pin matches the vendored code and declares integrity", async () => {
        const pin = JSON.parse(readFileSync(join(ROOT, "vendor/kysely/VENDOR.json"), "utf8"))
        assert.equal(pin.name, "kysely")
        assert.equal(pin.version, "0.29.3")
        assert.truthy(pin.integrity.startsWith("sha512-"))
        const kysely = await import("../../vendor/kysely/index.js")
        assert.equal(typeof kysely.Kysely, "function")
        assert.equal(typeof kysely.DummyDriver, "function")
    })

    Test.it("VND-02 BOUNDARY: no production code outside src/core/Data/ touches vendor/kysely", () => {
        // The rule governs production code (src/ + bin/). Tests may reference
        // the vendored package to verify it — that is their job.
        const offenders = []
        const walk = (dir) => {
            for (const entry of readdirSync(dir)) {
                const path = join(dir, entry)
                if (statSync(path).isDirectory()) walk(path)
                else if (entry.endsWith(".js")) {
                    const source = readFileSync(path, "utf8")
                    if (source.includes("vendor/kysely") && !path.includes(join("src", "core", "Data")))
                        offenders.push(path.slice(ROOT.length))
                }
            }
        }
        for (const dir of ["src", "bin"]) walk(join(ROOT, dir))
        assert.deepEqual(offenders, [], `vendor/kysely imported outside the boundary: ${offenders.join(", ")}`)
    })

    Test.it("VND-03 compile-only: SQL + bindings are generated with zero drivers", () => {
        const db = createCompiler("sqlite")
        const compiled = db
            .selectFrom("customer")
            .select(["id", "tier"])
            .where("tier", "=", "gold")
            .compile()
        assert.truthy(compiled.sql.toLowerCase().startsWith("select"))
        assert.truthy(compiled.sql.includes('"customer"'))
        assert.deepEqual([...compiled.parameters], ["gold"])
    })

    Test.it("VND-04 the expression builder nests and/or arbitrarily — the AST target API", () => {
        const db = createCompiler("sqlite")
        const compiled = db
            .selectFrom("customer")
            .selectAll()
            .where((eb) =>
                eb.or([
                    eb.and([eb("tier", "=", "gold"), eb("age", ">", 40)]),
                    eb("owner", "=", "u1")
                ])
            )
            .compile()
        assert.truthy(compiled.sql.includes("("), "nesting must parenthesize")
        assert.truthy(/or/i.test(compiled.sql) && /and/i.test(compiled.sql))
        assert.deepEqual([...compiled.parameters], ["gold", 40, "u1"])
    })

    Test.it("VND-05 dialects differ where they must: quoting and placeholders", () => {
        const query = (db) => db.selectFrom("t").select("a").where("a", "=", 1).compile()
        const sqlite = query(createCompiler("sqlite"))
        const postgres = query(createCompiler("postgres"))
        const mysql = query(createCompiler("mysql"))
        assert.truthy(sqlite.sql.includes('"t"') && sqlite.sql.includes("?"))
        assert.truthy(postgres.sql.includes('"t"') && postgres.sql.includes("$1"))
        assert.truthy(mysql.sql.includes("`t`") && mysql.sql.includes("?"))
        // Turso rides the sqlite compiler (SQL-dialect compatible)
        assert.equal(query(createCompiler("turso")).sql, sqlite.sql)
    })

    Test.it("VND-06 unknown dialects are rejected loudly with E_DIALECT", () => {
        assert.throws(() => createCompiler("oracle"), "E_DIALECT")
        assert.deepEqual([...DIALECT_NAMES].sort(), ["mysql", "postgres", "sqlite", "turso"])
    })
})
