/**
 * Users / identities conformance (USER-*) — ARCHITECTURE.md §342 (user = ZEN
 * pubkey) / §195 (policies per role or user). Pure identity operations, the
 * `nexus user` CLI, and the dev /_studio/users endpoint + /api/v1/_session.
 * The end-to-end sign-in (passphrase → keypair → challenge → token) is covered
 * by AUTH-06/07 and verified in-browser; here we pin the management surface.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { listUsers, addUser, removeUser, setRoles, labelOf } from "../../src/core/App/users.js"

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

    Test.it("USER-03 dev endpoints: /api/v1/_session and /_studio/users manage identities", async () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-usere-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const server = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: join(scratch, "shop") })
        try {
            const base = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("dev did not start")), 6000)
                let buf = ""
                server.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
                server.on("exit", () => reject(new Error("dev exited early")))
            })
            const post = (body) => fetch(base + "/_studio/users", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json())

            // no identities yet → auth not required (open DEV mode)
            assert.equal((await (await fetch(base + "/api/v1/_session")).json()).data.authRequired, false)

            const added = await post({ action: "add", pub: "PUBweb", name: "Web", roles: ["admin"] })
            assert.equal(added.ok, true)
            assert.equal(added.data.identities.length, 1)
            const listed = await (await fetch(base + "/_studio/users")).json()
            assert.equal(listed.data.identities[0].name, "Web")
            const removed = await post({ action: "remove", pub: "PUBweb" })
            assert.deepEqual(removed.data.identities, [])
            // a bad add is rejected
            assert.equal((await post({ action: "add", pub: "" })).ok, false)
        } finally {
            await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })
})
