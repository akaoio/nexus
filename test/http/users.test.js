/**
 * Users / identities conformance (USER-*) — ARCHITECTURE.md §342 (user = ZEN
 * pubkey) / §195 (policies per role or user). Pure identity operations, the
 * `nexus user` CLI, and the dev /_studio/users endpoint + /api/v1/_session.
 * The end-to-end sign-in (passphrase → keypair → challenge → token) is covered
 * by AUTH-06/07 and verified in-browser; here we pin the management surface.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { listUsers, addUser, removeUser, setRoles, labelOf } from "../../src/core/App/users.js"

const ZEN = (await import("../../vendor/zen/zen.js")).default

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

Test.describe("Users / identities (USER)", () => {
    Test.it("USER-01 pure ops: add/list/remove/setRoles with validation", () => {
        let ids = []
        ids = addUser(ids, { pub: "PUBa", name: "Ann", roles: ["admin", "admin"] })
        assert.equal(ids.length, 1)
        assert.deepEqual(ids[0].roles, ["admin"]) // deduped
        assert.equal(ids[0].name, "Ann")
        assert.throws(() => addUser(ids, { pub: "PUBa" }), "E_EXISTS")
        assert.throws(() => addUser(ids, { pub: "" }), "E_PUB")
        ids = setRoles(ids, "PUBa", ["editor"])
        assert.deepEqual(ids[0].roles, ["editor"])
        assert.throws(() => setRoles(ids, "NOPE", []), "E_NOT_FOUND")
        ids = removeUser(ids, "PUBa")
        assert.equal(ids.length, 0)
        assert.equal(labelOf({ pub: "0123456789abcdef" }), "0123456789…cdef")
    })

    Test.it("USER-02 the `nexus user` CLI persists identities to nexus.config.json", () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-user-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const cwd = join(scratch, "shop")
        const run = (args) => spawnSync(process.execPath, [BIN, "user", ...args, "--json"], { cwd, encoding: "utf8" })

        assert.equal(JSON.parse(run(["add", "PUBx", "--name", "Bo", "--roles", "admin,editor"]).stdout).ok, true)
        const listed = JSON.parse(run(["list"]).stdout)
        assert.equal(listed.users.length, 1)
        assert.deepEqual(listed.users[0].roles, ["admin", "editor"])
        run(["role", "PUBx", "--roles", "viewer"])
        assert.deepEqual(JSON.parse(readFileSync(join(cwd, "nexus.config.json"), "utf8")).identities[0].roles, ["viewer"])
        run(["remove", "PUBx"])
        assert.deepEqual(JSON.parse(readFileSync(join(cwd, "nexus.config.json"), "utf8")).identities, [])
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("USER-03 dev endpoints: /api/v1/_session and /_studio/users manage identities — and the FIRST identity closes the door behind itself", async () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-usere-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const cwd = join(scratch, "shop")
        const cfgPath = join(cwd, "nexus.config.json")
        const cfg = JSON.parse(readFileSync(cfgPath, "utf8"))
        cfg.token_secret = "fixed-users-secret"
        writeFileSync(cfgPath, JSON.stringify(cfg, null, 4))
        const server = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd })
        try {
            const base = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("dev did not start")), 6000)
                let buf = ""
                server.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
                server.on("exit", () => reject(new Error("dev exited early")))
            })
            const auth = (token) => (token ? { authorization: "Bearer " + token } : {})
            const post = (body, token) => fetch(base + "/_studio/users", { method: "POST", headers: { "content-type": "application/json", ...auth(token) }, body: JSON.stringify(body) }).then((r) => r.json())
            const get = (token) => fetch(base + "/_studio/users", { headers: auth(token) })

            // no identities yet → auth not required (open DEV mode)
            assert.equal((await (await fetch(base + "/api/v1/_session")).json()).data.authRequired, false)

            // A REAL keypair, not a placeholder string: the moment this identity
            // lands, the door closes, and the only way onward is to actually
            // hold the key. A fake pub would provision a lock with no key.
            const pair = await ZEN.pair(null, { seed: "users-endpoint-admin" })
            const added = await post({ action: "add", pub: pair.pub, name: "Web", roles: ["admin"] })
            assert.equal(added.ok, true)
            assert.equal(added.data.identities.length, 1)

            // NO RESTART: the very next read of the surface that just granted
            // this is refused (STUDIO-14 pins the same law for /_studio/config).
            assert.equal((await get()).status, 401, "the first identity must lock /_studio/* live")
            assert.equal((await (await fetch(base + "/api/v1/_session")).json()).data.authRequired, true)

            // ...and holding the key opens it again. This is the whole recovery
            // path: provision, sign in, carry on managing.
            const chal = await (await fetch(base + "/api/v1/_auth/challenge", { method: "POST" })).json()
            const signature = await ZEN.sign(chal.data.nonce, pair)
            const verified = await (await fetch(base + "/api/v1/_auth/verify", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ pub: pair.pub, nonce: chal.data.nonce, signature })
            })).json()
            assert.equal(verified.ok, true, JSON.stringify(verified))
            const token = verified.data.token

            const listed = await (await get(token)).json()
            assert.equal(listed.data.identities[0].name, "Web")
            const removed = await post({ action: "remove", pub: pair.pub }, token)
            assert.deepEqual(removed.data.identities, [])
            // a bad add is rejected (the last identity is gone, so open again)
            assert.equal((await post({ action: "add", pub: "" })).ok, false)
        } finally {
            await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })
})
