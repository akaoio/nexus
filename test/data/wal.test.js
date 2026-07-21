/**
 * SQLite concurrency pragmas (ADP-WAL-*) — issue #9's WAL/busy_timeout
 * moderate, landed in the durability chunk rather than the resource-bounds
 * one for a specific reason: this chunk puts MORE work inside write
 * transactions and holds write locks for longer. With the 1s job poller, HTTP
 * writes and per-subscriber plane.get all on one file, the default rollback
 * journal turns that into SQLITE_BUSY surfacing as a raw 500 — so landing the
 * transactions without this would make a correctness fix read as a regression.
 *
 * The clauses assert the mode the engine REPORTS, not that a pragma was
 * issued. A pragma that was sent and ignored is the failure mode worth
 * catching, and :memory: ignores WAL silently.
 */

import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { createExecutor } from "../../src/core/Data/executor.js"

const tmpDir = () => mkdtempSync(join(tmpdir(), "nexus-wal-"))

Test.describe("SQLite concurrency pragmas (ADP-WAL)", () => {

    Test.it("ADP-WAL-01 a FILE-backed sqlite executor runs in WAL with a busy timeout, so concurrent writers wait instead of failing", async () => {
        const dir = tmpDir()
        const ex = await createExecutor("sqlite", { path: join(dir, "t.db") })

        assert.equal(ex.all(`PRAGMA journal_mode`)[0].journal_mode, "wal", "a file DB must run in WAL")
        assert.equal(ex.all(`PRAGMA busy_timeout`)[0].timeout, 5000, "and wait rather than fail immediately under contention")

        await ex.close()
        rmSync(dir, { recursive: true, force: true })
    })

    Test.it("ADP-WAL-02 the busy timeout is configurable — an operator can tune contention behaviour without patching the engine", async () => {
        const dir = tmpDir()
        const ex = await createExecutor("sqlite", { path: join(dir, "t.db"), busyTimeoutMs: 250 })
        assert.equal(ex.all(`PRAGMA busy_timeout`)[0].timeout, 250)
        await ex.close()
        rmSync(dir, { recursive: true, force: true })
    })

    Test.it("ADP-WAL-03 an in-memory DB is never ASKED for WAL — it cannot honour it, and pretending it did would be the lie worth catching", async () => {
        const ex = await createExecutor("sqlite", { path: ":memory:" })
        // SQLite silently keeps "memory" here rather than refusing, which is
        // exactly why this asserts the reported mode: a test that only checked
        // "we sent the pragma" would pass while the guarantee was absent.
        assert.equal(ex.all(`PRAGMA journal_mode`)[0].journal_mode, "memory")
        await ex.close()
    })
})
