/**
 * `nexus site backup` streams instead of inhaling (SITE-STREAM-*) — issue #9's
 * "SELECT * of the whole DB into one in-memory JSON document".
 *
 * The security chunk made backup COMPLETE (system entities included), which
 * made this strictly worse: it now inhales a larger table set than before.
 *
 * The contract these clauses protect is the round trip (ARCHITECTURE.md §4.4):
 * whatever backup writes, restore must accept, and it must never delete data at
 * the destination. So SITE-STREAM-01 asserts the PARSED document, not the
 * bytes — indentation is not part of that promise, and pinning it would make
 * the writer fragile for nothing.
 */

import { spawnSync } from "child_process"
import { mkdtempSync, rmSync, readFileSync, readdirSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"
import Test, { assert } from "../../src/core/Test.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))
const url = (rel) => fileURLToPath(new URL(rel, import.meta.url)).replace(/\\/g, "/")

/** A migrated instance carrying `count` task rows with predictable ids. */
function instanceWithRows(count) {
    const scratch = mkdtempSync(join(tmpdir(), "nexus-backup-"))
    spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
    const instance = join(scratch, "shop")
    spawnSync(process.execPath, [BIN, "migrate", "--apply"], { cwd: instance })

    // Seeded through the instance's own data layer rather than by poking the
    // file, so the rows are exactly what the engine would have written.
    const seedFile = join(instance, "seed.mjs")
    writeFileSync(seedFile, `
import { openInstanceData } from "${url("../../src/cli/data.js")}"
import { loadInstance } from "${url("../../src/cli/instance.js")}"
const { config } = loadInstance(process.cwd())
const { executor } = await openInstanceData(process.cwd(), config)
for (let i = 0; i < ${count}; i++)
    await executor.run("INSERT INTO task (id, owner, created_at, updated_at, title) VALUES (?, ?, ?, ?, ?)",
        [String(i).padStart(6, "0"), "u1", "2026-07-21T00:00:00.000Z", "2026-07-21T00:00:00.000Z", "task " + i])
executor.close?.()
`)
    const seeded = spawnSync(process.execPath, [seedFile], { cwd: instance, encoding: "utf8" })
    if (seeded.status !== 0) throw new Error(`seeding failed: ${seeded.stderr}`)
    return { scratch, instance }
}

const backupFileIn = (instance) => readdirSync(instance).find((f) => f.startsWith("backup-") && f.endsWith(".json"))

Test.describe("Backup streams (SITE-STREAM)", () => {

    Test.it("SITE-STREAM-01 the streamed document is the shape restore accepts, and paging drops or duplicates nothing", () => {
        const { scratch, instance } = instanceWithRows(120)
        try {
            const r = spawnSync(process.execPath, [BIN, "site", "backup", "--json"], { cwd: instance, encoding: "utf8" })
            assert.equal(r.status, 0, r.stderr)

            const file = backupFileIn(instance)
            assert.truthy(file, "a backup file must be written")
            const doc = JSON.parse(readFileSync(join(instance, file), "utf8"))

            assert.equal(doc.backupVersion, 1)
            assert.equal(doc.secretsRedacted, true)
            assert.truthy(doc.createdAt && doc.config && doc.apps && doc.data && doc.migrations)

            // The page boundary is where a streaming writer goes wrong, so this
            // checks identity and not merely the count.
            assert.equal(doc.data.task.length, 120)
            const ids = doc.data.task.map((row) => row.id).sort()
            assert.equal(new Set(ids).size, 120, "no duplicates across page boundaries")
            assert.equal(ids[0], "000000")
            assert.equal(ids[119], "000119")

            // Whatever `data` contains, the SUMMARY must describe it — see
            // SITE-COUNT-01 for why that is not a given.
            assert.truthy("task" in doc.data)
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("SITE-COUNT-01 the summary counts what was actually captured, and NAMES what it skipped", () => {
        // A fresh instance has no system tables yet — they are created when a
        // server first boots — so backup legitimately captures none of them.
        // What was not legitimate: the summary counted every schema it INTENDED
        // to back up, so an operator read "Backed up 8 entities" and received
        // one. The security chunk made backup complete; it did not make the
        // report honest, and a backup that overstates itself is the kind of
        // thing discovered at the worst possible moment.
        const { scratch, instance } = instanceWithRows(3)
        try {
            const r = spawnSync(process.execPath, [BIN, "site", "backup", "--json"], { cwd: instance, encoding: "utf8" })
            assert.equal(r.status, 0, r.stderr)
            const summary = JSON.parse(r.stdout.trim().split("\n").pop())

            const doc = JSON.parse(readFileSync(join(instance, backupFileIn(instance)), "utf8"))
            assert.equal(summary.entities, Object.keys(doc.data).length, "the count must be what the file actually holds")
            assert.equal(summary.rows, 3)
            assert.truthy(Array.isArray(summary.skipped), "and anything left out must be named, not silently dropped")
            assert.truthy(summary.skipped.includes("nexus_user"), `expected nexus_user among skipped, got ${JSON.stringify(summary.skipped)}`)
        } finally {
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("SITE-STREAM-02 a streamed backup restores into a fresh instance — the round trip still holds", () => {
        const { scratch, instance } = instanceWithRows(120)
        let target = null
        try {
            spawnSync(process.execPath, [BIN, "site", "backup", "--json"], { cwd: instance, encoding: "utf8" })
            const file = backupFileIn(instance)

            target = mkdtempSync(join(tmpdir(), "nexus-restore-"))
            spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: target })
            const restored = join(target, "shop")
            spawnSync(process.execPath, [BIN, "migrate", "--apply"], { cwd: restored })
            writeFileSync(join(restored, file), readFileSync(join(instance, file)))

            // --apply, not the dry run: a clause that only previews would pass
            // against a document restore can parse but not actually ingest.
            const r = spawnSync(process.execPath, [BIN, "site", "restore", file, "--apply", "--json"], { cwd: restored, encoding: "utf8" })
            assert.equal(r.status, 0, r.stderr || r.stdout)
            const report = JSON.parse(r.stdout.trim().split("\n").pop())
            assert.equal(report.apply, true)
            assert.equal(report.inserted.task, 120, "every streamed row must land at the destination")
        } finally {
            if (target) rmSync(target, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })
})
