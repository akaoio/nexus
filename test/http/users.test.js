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

    Test.it("USER-03 the dev identity surface: /api/v1/_session, and the FIRST identity closing the door behind itself", async () => {
        // This used to drive `/_studio/users`, which is gone (STUDIO-12): it
        // had no caller, and its `remove` action edited nexus.config.json while
        // leaving the directory row that actually grants login — a remove that
        // did not remove. The property worth keeping was never that endpoint's;
        // it is the plane's, and the plane is where it is asserted now.
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
                const timer = setTimeout(() => reject(new Error("dev did not start")), 8000)
                let buf = ""
                server.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
                server.on("exit", () => reject(new Error("dev exited early")))
            })
            const session = async () => (await (await fetch(base + "/api/v1/_session")).json()).data

            // No identities yet → auth not required, and the request runs as
            // the loud DEV identity (production refuses that outright).
            const open = await session()
            assert.equal(open.authRequired, false)
            assert.equal(open.user, "dev")

            // A REAL keypair: the moment this identity lands the door closes,
            // and the only way onward is to actually hold the key. Provisioned
            // through the ordinary plane, which is what the Studio's own users
            // page does.
            const pair = await ZEN.pair(null, { seed: "users-endpoint-admin" })
            const made = await fetch(base + "/api/v1/nexus_user", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ pub: pair.pub, name: "Web", roles: JSON.stringify(["admin"]) })
            })
            assert.equal(made.status, 201, await made.text())

            // NO RESTART: the very next read of the surface that just granted
            // this is refused (STUDIO-14 pins the same law for /_studio/config).
            const closed = await session()
            assert.equal(closed.authRequired, true)
            assert.equal(closed.user, null, "an anonymous caller is nobody the moment an identity exists")

            // …and holding the key opens it again — the whole recovery path.
            const chal = await (await fetch(base + "/api/v1/_auth/challenge", { method: "POST" })).json()
            const signature = await ZEN.sign(chal.data.nonce, pair)
            const verified = await (await fetch(base + "/api/v1/_auth/verify", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ pub: pair.pub, nonce: chal.data.nonce, signature })
            })).json()
            assert.equal(verified.ok, true, JSON.stringify(verified))

            const me = await (await fetch(base + "/api/v1/_session", { headers: { authorization: "Bearer " + verified.data.token } })).json()
            assert.equal(me.data.user, pair.pub)
            assert.deepEqual(me.data.roles, ["admin"])
        } finally {
            await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })
})
