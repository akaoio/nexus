/**
 * Roles resolve PER REQUEST, not per token (AUTH-REVOKE, issue #9 I4). A
 * bearer session token proves IDENTITY only — `context()` must look up
 * roles from the LIVE nexus_user directory on every request, the same
 * source /_auth/verify and the Studio gate already read. Stripping a
 * user's roles (an admin-only write, Task 1) must take effect on the
 * user's NEXT request, without re-issuing or revoking the token itself —
 * there is no denylist and no token version to synchronize.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))
const ZEN = (await import("../../vendor/zen/zen.js")).default

// auth-on instance: one ZEN identity (imported into nexus_user at boot —
// the config seed becomes the row Task 1's admin-only `roles` write path
// governs) plus one admin API key, used ONLY to perform the admin-gated
// PATCH (Task 1: self-service, permlevel 0, may never write its own roles).
const scratch = mkdtempSync(join(tmpdir(), "nexus-revoke-"))
spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
const instance = join(scratch, "shop")
const adminPair = await ZEN.pair(null, { seed: "revoke-admin" })
const ROOT_KEY = "root-key-0123456789abcdef"
const cfgPath = join(instance, "nexus.config.json")
const cfg = JSON.parse(readFileSync(cfgPath, "utf8"))
cfg.token_secret = "fixed-revocation-secret"
cfg.identities = [{ pub: adminPair.pub, roles: ["admin"] }]
cfg.api_keys = [{ key: ROOT_KEY, user: "root", roles: ["admin"] }]
writeFileSync(cfgPath, JSON.stringify(cfg, null, 4))

let server = null
let base = null
async function ensure() {
    if (base) return base
    server = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: instance })
    base = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev did not start")), 8000)
        let buf = ""
        server.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
        server.on("exit", () => reject(new Error("dev exited early")))
    })
    return base
}
async function signInAs(pair) {
    const b = await ensure()
    const chal = await (await fetch(b + "/api/v1/_auth/challenge", { method: "POST" })).json()
    const signature = await ZEN.sign(chal.data.nonce, pair)
    const verified = await (await fetch(b + "/api/v1/_auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pub: pair.pub, nonce: chal.data.nonce, signature })
    })).json()
    return verified.data.token
}
async function withToken(token, method, path, body) {
    const r = await fetch((await ensure()) + path, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: r.status, body: await r.json() }
}
async function callAs(key, method, path, body) {
    const r = await fetch((await ensure()) + path, {
        method,
        headers: { "content-type": "application/json", "x-nexus-key": key },
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: r.status, body: await r.json() }
}

Test.describe("Roles resolve per request, not per token (AUTH-REVOKE)", () => {
    Test.it("AUTH-REVOKE clearing a user's roles takes effect immediately, without re-issuing the token", async () => {
        const token = await signInAs(adminPair) // token minted while admin
        assert.equal((await withToken(token, "POST", "/api/v1/nexus_role", { name: "probe" })).body.ok, true)

        // find the imported row for this identity — GET list, filter by pub
        const list = await callAs(ROOT_KEY, "GET", "/api/v1/nexus_user")
        const row = list.body.data.find((r) => r.pub === adminPair.pub)
        assert.truthy(row, "the config identity was imported into nexus_user at boot")

        await callAs(ROOT_KEY, "PATCH", `/api/v1/nexus_user/${row.id}`, { roles: JSON.stringify([]) })

        const after = await withToken(token, "POST", "/api/v1/nexus_role", { name: "probe2" })
        assert.equal(after.body.ok, false) // same token, no longer admin
        assert.equal(after.body.error.code, "E_FORBIDDEN")
    })

    Test.it("AUTH-REVOKE-DELETE deleting a config-seeded identity's row revokes it — the config seed is bootstrap-only", async () => {
        // the prior test cleared this row's roles — restore admin so this
        // test starts from a known-good state independent of test order
        const preList = await callAs(ROOT_KEY, "GET", "/api/v1/nexus_user")
        const preRow = preList.body.data.find((r) => r.pub === adminPair.pub)
        assert.truthy(preRow, "the config identity was imported into nexus_user at boot")
        await callAs(ROOT_KEY, "PATCH", `/api/v1/nexus_user/${preRow.id}`, { roles: JSON.stringify(["admin"]) })

        const token = await signInAs(adminPair) // token minted while admin
        assert.equal((await withToken(token, "POST", "/api/v1/nexus_role", { name: "probe-del-1" })).body.ok, true)

        // keep the directory non-empty after the deletion below — this is the
        // realistic "revoke one identity, others remain" case, not the
        // degenerate empty-directory bootstrap case
        const fillerPair = await ZEN.pair(null, { seed: "revoke-filler" })
        const filler = await callAs(ROOT_KEY, "POST", "/api/v1/nexus_user", { pub: fillerPair.pub, roles: JSON.stringify([]) })
        assert.equal(filler.body.ok, true)

        const row = preRow

        const removed = await callAs(ROOT_KEY, "DELETE", `/api/v1/nexus_user/${row.id}`)
        assert.equal(removed.status, 200)

        // the SAME token must be refused now — no falling back to the config seed
        const after = await withToken(token, "POST", "/api/v1/nexus_role", { name: "probe-del-2" })
        assert.equal(after.body.ok, false)
        assert.equal(after.body.error.code, "E_FORBIDDEN")

        // a fresh handshake for the deleted pub must also be refused — no longer provisioned
        const b = await ensure()
        const chal = await (await fetch(b + "/api/v1/_auth/challenge", { method: "POST" })).json()
        const signature = await ZEN.sign(chal.data.nonce, adminPair)
        const verified = await (await fetch(b + "/api/v1/_auth/verify", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ pub: adminPair.pub, nonce: chal.data.nonce, signature })
        })).json()
        assert.equal(verified.ok, false)
        assert.equal(verified.error.code, "E_AUTH")
    })

    Test.it("AUTH-REVOKE-99 cleanup", async () => {
        if (server) await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        assert.equal(true, true)
    })
})
