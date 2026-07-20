/**
 * CLI operations conformance — migrate / site backup·restore / app / doctor
 * (OPS-*). Everything e2e through the real binary on real instances; the
 * §4.4 contracts at the command line: dry-run by default, the additive
 * restore that NEVER deletes destination data, the ledger that never
 * re-runs.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync, readdirSync, copyFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))
const run = (args, cwd) => {
    const result = spawnSync(process.execPath, [BIN, ...args, "--json"], { cwd, encoding: "utf8" })
    let data = null
    try {
        data = JSON.parse(result.stdout)
    } catch {}
    return { code: result.status, data, stdout: result.stdout, stderr: result.stderr }
}

const scratch = mkdtempSync(join(tmpdir(), "nexus-ops-"))
const A = join(scratch, "site-a")
const B = join(scratch, "site-b")

const sqlite = async (root, sql, params = []) => {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(join(root, ".nexus", "data.db"))
    const rows = db.prepare(sql).all(...params)
    db.close()
    return rows
}

const insertTask = async (root, id, title) => {
    const { DatabaseSync } = await import("node:sqlite")
    const db = new DatabaseSync(join(root, ".nexus", "data.db"))
    db.prepare("INSERT INTO task (id, title) VALUES (?, ?)").run(id, title)
    db.close()
}

Test.describe("CLI operations (OPS-*)", () => {
    Test.it("OPS-01 migrate bootstraps: preview first, --apply creates tables and the baseline snapshot", async () => {
        run(["create", "site-a"], scratch)
        const preview = run(["migrate"], A)
        assert.equal(preview.code, 0)
        assert.equal(preview.data.bootstrap, true)
        assert.equal(existsSync(join(A, ".nexus", "schemas.json")), false, "preview must not write")
        const applied = run(["migrate", "--apply"], A)
        assert.equal(applied.data.bootstrap, true)
        assert.truthy(existsSync(join(A, ".nexus", "schemas.json")))
        assert.equal((await sqlite(A, "SELECT COUNT(*) AS n FROM task"))[0].n, 0)
    })

    Test.it("OPS-02 an additive edit hot-applies; existing rows keep riding", async () => {
        await insertTask(A, "01A", "first")
        const modelPath = join(A, "apps/starter/models/task.json")
        const model = JSON.parse(readFileSync(modelPath, "utf8"))
        model.fields.push({ name: "nick", type: "text" })
        writeFileSync(modelPath, JSON.stringify(model, null, 4))

        const preview = run(["migrate"], A)
        assert.equal(preview.data.hot.length, 1)
        assert.equal(preview.data.apply, false)
        const applied = run(["migrate", "--apply"], A)
        assert.equal(applied.code, 0)
        const columns = (await sqlite(A, "PRAGMA table_info(task)")).map((c) => c.name)
        assert.truthy(columns.includes("nick"))
        assert.equal((await sqlite(A, "SELECT title FROM task"))[0].title, "first")
    })

    Test.it("OPS-03 a structural edit generates a reviewable migration; --apply runs it through the ledger once", async () => {
        const modelPath = join(A, "apps/starter/models/task.json")
        const model = JSON.parse(readFileSync(modelPath, "utf8"))
        model.fields = model.fields.filter((f) => f.name !== "due")
        writeFileSync(modelPath, JSON.stringify(model, null, 4))

        const preview = run(["migrate"], A)
        assert.equal(preview.data.generated.length, 1)
        const file = preview.data.generated[0]
        assert.truthy(existsSync(join(A, file)))
        const again = run(["migrate"], A)
        assert.equal(again.data.generated.length, 0, "generation is idempotent")
        assert.equal(again.data.pending.length, 1)

        const applied = run(["migrate", "--apply"], A)
        assert.equal(applied.data.applied.length, 1)
        const columns = (await sqlite(A, "PRAGMA table_info(task)")).map((c) => c.name)
        assert.falsy(columns.includes("due"))
        assert.equal((await sqlite(A, "SELECT title FROM task"))[0].title, "first", "data survives the rebuild")
        const rerun = run(["migrate", "--apply"], A)
        assert.equal(rerun.data.applied.length, 0, "the ledger never re-runs")
    })

    Test.it("OPS-04 site backup captures schemas, data and the ledger", () => {
        const result = run(["site", "backup", "dump.json"], A)
        assert.equal(result.code, 0)
        const dump = JSON.parse(readFileSync(join(A, "dump.json"), "utf8"))
        assert.equal(dump.backupVersion, 1)
        assert.equal(dump.data.task.length, 1)
        assert.equal(dump.migrations.length, 1)
        assert.truthy(dump.apps.starter["manifest.json"])
    })

    Test.it("OPS-05 restore into a fresh instance is equivalent; restoring twice is a no-op", async () => {
        run(["create", "site-b"], scratch)
        rmSync(join(B, "apps"), { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) // truly fresh
        copyFileSync(join(A, "dump.json"), join(B, "dump.json"))

        const preview = run(["site", "restore", "dump.json"], B)
        assert.equal(preview.data.apply, false)
        assert.equal(existsSync(join(B, "apps", "starter")), false, "preview must not write")

        const applied = run(["site", "restore", "dump.json", "--apply"], B)
        assert.deepEqual(applied.data.appsWritten, ["starter"])
        assert.equal(applied.data.inserted.task, 1)
        assert.equal((await sqlite(B, "SELECT title FROM task"))[0].title, "first")
        assert.equal(applied.data.ledger, 1)

        const again = run(["site", "restore", "dump.json", "--apply"], B)
        assert.equal(again.data.inserted.task, 0)
        assert.equal(again.data.skipped.task, 1, "idempotent — nothing duplicated")
    })

    Test.it("OPS-06 THE CONTRACT: restore never deletes or overwrites existing destination data", async () => {
        await insertTask(B, "02B", "local precious")
        const result = run(["site", "restore", "dump.json", "--apply"], B)
        assert.equal(result.code, 0)
        const rows = await sqlite(B, "SELECT id, title FROM task ORDER BY id")
        assert.equal(rows.length, 2, "the local row SURVIVED the restore")
        assert.truthy(rows.some((r) => r.title === "local precious"))
        assert.deepEqual(result.data.appsSkipped, ["starter"], "existing apps are never overwritten")
    })

    Test.it("OPS-07 app new scaffolds and refuses duplicates; app list reports", () => {
        const created = run(["app", "new", "crm"], A)
        assert.equal(created.code, 0)
        assert.truthy(existsSync(join(A, "apps", "crm", "manifest.json")))
        assert.equal(run(["app", "new", "crm"], A).code, 1)
        const list = run(["app", "list"], A)
        assert.deepEqual(list.data.apps.map((a) => a.name).sort(), ["crm", "starter"])
    })

    Test.it("OPS-08 doctor: healthy instance exits 0; a broken model is a loud finding", () => {
        const healthy = run(["doctor"], A)
        assert.equal(healthy.code, 0)
        assert.equal(healthy.data.ok, true)

        const modelPath = join(A, "apps/starter/models/task.json")
        const good = readFileSync(modelPath, "utf8")
        const bad = JSON.parse(good)
        bad.fields.push({ name: "x", type: "teleport" })
        writeFileSync(modelPath, JSON.stringify(bad))
        const sick = run(["doctor"], A)
        assert.equal(sick.code, 1)
        assert.equal(sick.data.ok, false)
        assert.truthy(sick.data.checks.some((c) => !c.ok && c.name === "schemas + manifests"))
        writeFileSync(modelPath, good)
    })

    Test.it("OPS-09 restore FITS rows to the destination schema — dropped columns project away, unsatisfiable required rows reject", async () => {
        const home = mkdtempSync(join(tmpdir(), "nexus-ops-restore-"))
        // Source has an extra `legacy` field (later dropped) and an optional
        // `tag` (later made required at the destination).
        run(["create", "src"], home)
        const src = join(home, "src")
        const srcModel = join(src, "apps/starter/models/task.json")
        const m = JSON.parse(readFileSync(srcModel, "utf8"))
        m.fields.push({ name: "legacy", type: "text" }, { name: "tag", type: "text" })
        writeFileSync(srcModel, JSON.stringify(m, null, 4))
        run(["migrate", "--apply"], src)
        const { DatabaseSync } = await import("node:sqlite")
        const sdb = new DatabaseSync(join(src, ".nexus", "data.db"))
        sdb.prepare("INSERT INTO task (id, title, legacy, tag) VALUES (?, ?, ?, ?)").run("R-fit", "keeps tag", "obsolete", "urgent")
        sdb.prepare("INSERT INTO task (id, title, legacy, tag) VALUES (?, ?, ?, ?)").run("R-notag", "no tag", "obsolete", null)
        sdb.close()
        run(["site", "backup", "dump.json"], src)

        // Destination: no `legacy`, and `tag` is REQUIRED without a default
        run(["create", "dst"], home)
        const dst = join(home, "dst")
        const dstModel = join(dst, "apps/starter/models/task.json")
        const dm = JSON.parse(readFileSync(dstModel, "utf8"))
        dm.fields.push({ name: "tag", type: "text", required: true })
        writeFileSync(dstModel, JSON.stringify(dm, null, 4))
        copyFileSync(join(src, "dump.json"), join(dst, "dump.json"))
        run(["migrate", "--apply"], dst)

        const result = run(["site", "restore", "dump.json", "--apply"], dst)
        assert.equal(result.code, 0, "restore must not crash")
        assert.equal(result.data.inserted.task, 1, "R-fit restores (legacy dropped, tag satisfied)")
        assert.equal(result.data.rejected.task, 1, "R-notag rejects (required tag cannot be invented)")
        const rows = await sqlite(dst, "SELECT id, tag FROM task ORDER BY id")
        assert.deepEqual(rows, [{ id: "R-fit", tag: "urgent" }], "only the fitted row, its dropped column gone")
        rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("OPS-10 SITE-BACKUP includes system entities and never writes a secret in cleartext", async () => {
        const home = mkdtempSync(join(tmpdir(), "nexus-ops-secret-"))
        run(["create", "shop"], home)
        const cwd = join(home, "shop")

        // Boot the real dev server on a FRESH instance (no configured
        // identities yet, so the dev pseudo-user is wide open) — it's the
        // path that ensures the SYSTEM tables exist, and lets us seed rows
        // through the same generic API the Studio uses.
        const server = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd })
        try {
            const base = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("dev did not start")), 6000)
                let buf = ""
                server.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
                server.on("exit", () => reject(new Error("dev exited early")))
            })
            const post = (path, body) => fetch(base + path, {
                method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
            }).then((r) => r.json())

            // order matters: the directory IS the auth source of truth — the
            // moment a nexus_user row exists, authState.required flips live
            // and the wide-open dev pseudo-user goes away. Create the policy
            // row first, the directory row last.
            const policy = await post("/api/v1/nexus_policy", {
                entity: "task", actions: JSON.stringify(["read"]), rule: null, permlevel: 0, ifowner: false
            })
            assert.equal(policy.ok, true, "the policy row was created via the API")
            const user = await post("/api/v1/nexus_user", { pub: "test-pub-key-1", name: "Ada", roles: JSON.stringify(["admin"]) })
            assert.equal(user.ok, true, "the directory row was created via the API")
        } finally {
            await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
        }

        // Secrets, seeded directly in nexus.config.json (as an operator would)
        const configPath = join(cwd, "nexus.config.json")
        const config = JSON.parse(readFileSync(configPath, "utf8"))
        config.token_secret = "super-secret-jwt-signing-key"
        config.api_keys = [{ key: "sk-live-topsecret", roles: ["admin"] }]
        writeFileSync(configPath, JSON.stringify(config, null, 4))

        const backupFile = "dump-secret.json"
        const result = run(["site", "backup", backupFile], cwd)
        assert.equal(result.code, 0)
        const doc = JSON.parse(readFileSync(join(cwd, backupFile), "utf8"))
        assert.truthy(doc.data.nexus_user?.length, "the directory is in the backup")
        assert.truthy(doc.data.nexus_policy?.length, "the policy rows are in the backup")
        assert.equal(doc.config.token_secret, "***")
        assert.equal(doc.config.api_keys[0].key, "***")
        assert.equal(doc.secretsRedacted, true, "the restore path must know")

        rmSync(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("OPS-99 cleanup", () => {
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        assert.equal(existsSync(scratch), false)
    })
})
