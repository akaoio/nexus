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

    Test.it("VND-07 the Data core is browser-safe: no module under src/core/Data/ statically imports a Node built-in, except the server-only executor", () => {
        // Sibling of VND-02: that clause pins the vendor/kysely boundary; this
        // one pins the browser boundary of the whole Data core (ARCHITECTURE.md
        // N2). The Studio schema designer statically imports migrate.js →
        // adapters.js; a single static `import ... from "module"` anywhere in
        // that graph makes the built Studio fail to evaluate in a browser (a
        // browser cannot resolve Node built-ins). So the rule is structural:
        // real driver machinery lives ONLY in the server-only executor.js;
        // adapters.js/migrate.js/ddl.js/kysely.js/compile.js/ulid.js stay pure.
        //
        // Scan for STATIC `import … from "<builtin>"` / `export … from "<builtin>"`
        // only — dynamic `import("node:sqlite")` inside a function is runtime and
        // never enters the browser's static module graph, so it is not poison.
        // node:sqlite is a legitimate runtime engine of the server tier; like
        // every other built-in it is allowed ONLY inside executor.js.
        const DATA_DIR = join(ROOT, "src", "core", "Data")
        const BUILTINS = new Set([
            "module", "url", "path", "fs", "crypto", "os",
            "child_process", "net", "http", "https", "stream", "zlib"
        ])
        const isBuiltin = (spec) => spec.startsWith("node:") || BUILTINS.has(spec)
        // Match static import/export-from statements and bare side-effect imports.
        // The binding list carries no quotes, so [^'"] cannot run past the string
        // literal into the next statement — dynamic import("…") has no `from` and
        // no whitespace-then-quote after `import`, so it never matches.
        const STATIC = /^\s*(?:import|export)(?:\s+[^'"]*?\s+from)?\s*['"]([^'"]+)['"]/gm
        const offenders = []
        for (const entry of readdirSync(DATA_DIR)) {
            if (!entry.endsWith(".js")) continue
            const source = readFileSync(join(DATA_DIR, entry), "utf8")
            for (const match of source.matchAll(STATIC)) {
                const spec = match[1]
                if (isBuiltin(spec) && entry !== "executor.js")
                    offenders.push(`${entry} → "${spec}"`)
            }
        }
        assert.truthy(
            offenders.length === 0,
            `Node built-in statically imported outside the server-only executor: ${offenders.join(", ")}`
        )
    })
})
