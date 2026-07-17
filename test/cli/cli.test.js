/**
 * CLI conformance — CLI-* clauses (ARCHITECTURE.md §5.2).
 *
 * The CLI is spawned as a real child process: exit codes, --json output
 * shapes (jsonVersion is a versioned public contract) and the no-TTY
 * plain-text rule are the spec — not implementation details.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/kernel/Test.js"
import { validate } from "../../src/model/Model.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))
const PKG = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"))

const run = (args, options = {}) => {
    const result = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", ...options })
    return { code: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

const runJson = (args, options = {}) => {
    const result = run([...args, "--json"], options)
    return { ...result, data: JSON.parse(result.stdout) }
}

/** A scratch instance created once and reused by read-only clauses. */
const scratch = mkdtempSync(join(tmpdir(), "nexus-cli-"))
const INSTANCE = join(scratch, "shop")

Test.describe("CLI — nexus (CLI-*)", () => {
    Test.it("CLI-01 --version prints the package version; --json carries { name, version }", () => {
        const text = run(["--version"])
        assert.equal(text.code, 0)
        assert.equal(text.stdout.trim(), `nexus v${PKG.version}`)
        const { code, data } = runJson(["version"])
        assert.equal(code, 0)
        assert.equal(data.jsonVersion, 1)
        assert.equal(data.version, PKG.version)
    })

    Test.it("CLI-02 no arguments prints usage listing every command, exit 0", () => {
        const { code, stdout } = run([])
        assert.equal(code, 0)
        for (const command of ["create", "dev", "test", "version", "help"])
            assert.truthy(stdout.includes(command), `usage must list ${command}`)
    })

    Test.it("CLI-03 an unknown command exits 2 with E_USAGE", () => {
        const { code, stderr } = run(["frobnicate"])
        assert.equal(code, 2)
        assert.truthy(stderr.includes("Unknown command"))
        const { code: jsonCode, data } = runJson(["frobnicate"])
        assert.equal(jsonCode, 2)
        assert.equal(data.ok, false)
        assert.equal(data.code, "E_USAGE")
    })

    Test.it("CLI-04 create scaffolds the expected instance tree", () => {
        const { code, data } = runJson(["create", "shop", "--site", "My Shop"], { cwd: scratch })
        assert.equal(code, 0)
        assert.equal(data.ok, true)
        assert.equal(data.site, "My Shop")
        for (const file of ["package.json", "nexus.config.json", "apps/starter/manifest.json", "apps/starter/models/task.json", "README.md"]) {
            assert.truthy(data.created.includes(file), `created must list ${file}`)
            assert.truthy(existsSync(join(INSTANCE, file)), `${file} must exist on disk`)
        }
    })

    Test.it("CLI-05 the scaffolded model passes the public Model API (dogfood)", () => {
        const model = JSON.parse(readFileSync(join(INSTANCE, "apps/starter/models/task.json"), "utf8"))
        assert.equal(validate(model).valid, true)
    })

    Test.it("CLI-05b --engine records the DB choice; the default is sqlite; a bogus engine exits 2", () => {
        const withEngine = runJson(["create", "shop-pg", "--engine", "postgres"], { cwd: scratch })
        assert.equal(withEngine.code, 0)
        assert.equal(withEngine.data.engine, "postgres")
        assert.equal(JSON.parse(readFileSync(join(scratch, "shop-pg", "nexus.config.json"), "utf8")).database.engine, "postgres")
        // default (no flag, non-interactive) is the zero-install sqlite
        assert.equal(JSON.parse(readFileSync(join(INSTANCE, "nexus.config.json"), "utf8")).database.engine, "sqlite")
        // a bogus engine is a usage error, nothing scaffolded
        const bogus = runJson(["create", "shop-bad", "--engine", "oracle"], { cwd: scratch })
        assert.equal(bogus.code, 2)
        assert.equal(bogus.data.code, "E_USAGE")
    })

    Test.it("CLI-06 create refuses a non-empty directory — never overwrites (exit 1, E_NOT_EMPTY)", () => {
        const { code, data } = runJson(["create", "shop"], { cwd: scratch })
        assert.equal(code, 1)
        assert.equal(data.ok, false)
        assert.equal(data.code, "E_NOT_EMPTY")
        // And the original file survived untouched
        const config = JSON.parse(readFileSync(join(INSTANCE, "nexus.config.json"), "utf8"))
        assert.equal(config.site.name, "My Shop")
    })

    Test.it("CLI-07 create without a directory argument exits 2", () => {
        const { code, data } = runJson(["create"], { cwd: scratch })
        assert.equal(code, 2)
        assert.equal(data.code, "E_USAGE")
    })

    Test.it("CLI-08 test validates a healthy instance: exit 0, machine-readable summary", () => {
        const { code, data } = runJson(["test"], { cwd: INSTANCE })
        assert.equal(code, 0)
        assert.equal(data.ok, true)
        assert.equal(data.invalid, 0)
        assert.equal(data.checked, 2) // manifest + task model
        assert.truthy(data.files.every((f) => f.valid))
    })

    Test.it("CLI-09 test catches a corrupted model: exit 1, error codes per file", () => {
        const broken = join(scratch, "broken")
        runJson(["create", "broken"], { cwd: scratch })
        const modelPath = join(broken, "apps/starter/models/task.json")
        const model = JSON.parse(readFileSync(modelPath, "utf8"))
        model.fields.push({ name: "task", type: "teleport" })
        writeFileSync(modelPath, JSON.stringify(model))
        const { code, data } = runJson(["test"], { cwd: broken })
        assert.equal(code, 1)
        assert.equal(data.ok, false)
        assert.equal(data.invalid, 1)
        const bad = data.files.find((f) => !f.valid)
        assert.truthy(bad.errors.some((e) => e.code === "E_UNKNOWN_TYPE"))
    })

    Test.it("CLI-10 outside an instance, test/dev exit 1 with E_NO_INSTANCE", () => {
        const { code, data } = runJson(["test"], { cwd: scratch })
        assert.equal(code, 1)
        assert.equal(data.code, "E_NO_INSTANCE")
    })

    Test.it("CLI-11 piped (non-TTY) output carries no ANSI escape codes", () => {
        const { stdout } = run(["help"])
        assert.equal(stdout.includes("\x1b["), false)
        const created = run(["test"], { cwd: INSTANCE })
        assert.equal(created.stdout.includes("\x1b["), false)
    })

    Test.it("CLI-12 dev serves the instance: index page, static files, no path traversal", async () => {
        const child = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: INSTANCE })
        try {
            const url = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("dev server did not start in time")), 5000)
                let buffer = ""
                child.stdout.on("data", (chunk) => {
                    buffer += chunk
                    try {
                        const data = JSON.parse(buffer)
                        clearTimeout(timer)
                        resolve(data.url)
                    } catch { /* JSON not complete yet */ }
                })
                child.on("exit", () => reject(new Error("dev exited early")))
            })

            const index = await fetch(url)
            assert.equal(index.status, 200)
            assert.truthy((await index.text()).includes("My Shop"))

            // SEC-01: instance files (config with any secrets) are NOT served
            const config = await fetch(`${url}/nexus.config.json`)
            assert.equal(config.status, 404)

            const traversal = await fetch(`${url}/..%2f..%2fetc%2fpasswd`)
            assert.equal(traversal.status, 404)
        } finally {
            await new Promise((resolve) => { child.once("exit", resolve); child.kill("SIGKILL") })
        }
    })

    Test.it("CLI-99 cleanup scratch directory", () => {
        // Windows can hold locks on just-closed sqlite files — retry briefly
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        assert.equal(existsSync(scratch), false)
    })
})
