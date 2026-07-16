/**
 * AuthN conformance — API keys + app-policy role assignment (AUTH-*).
 * docs/authn-design.md made real, e2e: configuring api_keys REQUIRES a key
 * (401 E_AUTH before the Data Plane), keys carry user+roles, and the apps'
 * permissions/*.json policies gate through role assignment.
 */

import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/kernel/Test.js"
import { policiesFor, loadPolicies, validatePolicy } from "../../src/app/Policies.js"

const BIN = new URL("../../bin/nexus.js", import.meta.url).pathname

Test.describe("AuthN — assignment helpers (AUTH)", () => {
    Test.it("AUTH-01 policiesFor: role-gated policies match by intersection; bare policies apply to everyone", () => {
        const all = [
            { entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: true }, // baseline
            { entity: "task", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false, roles: ["admin"] }
        ]
        assert.equal(policiesFor(all, []).length, 1)
        assert.equal(policiesFor(all, ["sales"]).length, 1)
        assert.equal(policiesFor(all, ["admin"]).length, 2)
    })

    Test.it("AUTH-02 loadPolicies reads permissions/*.json and validates loudly", () => {
        const root = mkdtempSync(join(tmpdir(), "nexus-pol-"))
        mkdirSync(join(root, "apps", "one", "permissions"), { recursive: true })
        writeFileSync(
            join(root, "apps", "one", "permissions", "base.json"),
            JSON.stringify([{ entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }])
        )
        const schemas = [{ name: "task", fields: [] }]
        assert.equal(loadPolicies(root, [{ dir: "one" }], schemas).length, 1)
        writeFileSync(join(root, "apps", "one", "permissions", "bad.json"), JSON.stringify([{ entity: "ghost", actions: ["read"] }]))
        assert.throws(() => loadPolicies(root, [{ dir: "one" }], schemas), "E_INVALID")
        assert.equal(validatePolicy({ entity: "task", actions: ["read"] }, schemas).valid, true)
        rmSync(root, { recursive: true, force: true })
    })

    Test.it("AUTH-03 E2E: api_keys require a key (401), stamp identity, and gate through app policies", async () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-auth-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const instance = join(scratch, "shop")

        // App policies: everyone reads own rows; admins do everything
        mkdirSync(join(instance, "apps", "starter", "permissions"), { recursive: true })
        writeFileSync(
            join(instance, "apps", "starter", "permissions", "base.json"),
            JSON.stringify([
                { entity: "task", actions: ["read", "create"], rule: null, permlevel: 0, ifOwner: true },
                { entity: "task", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false, roles: ["admin"] }
            ])
        )
        // Keys: an admin and a plain member
        const configPath = join(instance, "nexus.config.json")
        const config = JSON.parse(readFileSync(configPath, "utf8"))
        config.api_keys = [
            { key: "k-admin", user: "alice", roles: ["admin"] },
            { key: "k-member", user: "bob", roles: [] }
        ]
        writeFileSync(configPath, JSON.stringify(config, null, 4))

        const dev = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: instance })
        try {
            const base = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("dev did not start")), 5000)
                let buffer = ""
                dev.stdout.on("data", (chunk) => {
                    buffer += chunk
                    try {
                        clearTimeout(timer)
                        resolve(JSON.parse(buffer).url)
                    } catch {}
                })
                dev.on("exit", () => reject(new Error("dev exited early")))
            })
            const call = async (method, path, body, key) => {
                const response = await fetch(base + path, {
                    method,
                    headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) },
                    body: body === undefined ? undefined : JSON.stringify(body)
                })
                return { status: response.status, body: await response.json() }
            }

            // no key → 401 before anything else
            const denied = await call("GET", "/api/v1/task")
            assert.equal(denied.status, 401)
            assert.equal(denied.body.error.code, "E_AUTH")

            // member creates own row — identity from the KEY, not a header
            const created = await call("POST", "/api/v1/task", { title: "bob's" }, "k-member")
            assert.equal(created.status, 201)
            assert.equal(created.body.data.owner, "bob")

            // member sees own rows only (ifOwner baseline); cannot delete
            const admin = await call("POST", "/api/v1/task", { title: "alice's" }, "k-admin")
            const bobList = await call("GET", "/api/v1/task", undefined, "k-member")
            assert.deepEqual(bobList.body.data.map((r) => r.owner), ["bob"])
            const cantDelete = await call("DELETE", `/api/v1/task/${created.body.data.id}`, undefined, "k-member")
            assert.equal(cantDelete.status, 403)

            // admin sees everything and deletes
            const aliceList = await call("GET", "/api/v1/task", undefined, "k-admin")
            assert.equal(aliceList.body.data.length, 2)
            const removed = await call("DELETE", `/api/v1/task/${admin.body.data.id}`, undefined, "k-admin")
            assert.equal(removed.status, 200)
        } finally {
            dev.kill()
            rmSync(scratch, { recursive: true, force: true })
        }
    })
})
