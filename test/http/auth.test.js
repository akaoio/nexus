/**
 * AuthN conformance — API keys + app-policy role assignment (AUTH-*).
 * docs/authn-design.md made real, e2e: configuring api_keys REQUIRES a key
 * (401 E_AUTH before the Data Plane), keys carry user+roles, and the apps'
 * permissions/*.json policies gate through role assignment.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, readFileSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/kernel/Test.js"
import { policiesFor, loadPolicies, validatePolicy } from "../../src/app/Policies.js"
import { issueToken, verifyToken, verifyChallenge } from "../../src/app/auth.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))
const ZEN = (await import("../../vendor/zen/zen.js")).default

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

    Test.it("AUTH-04 ZEN identity is deterministically derivable from a seed — the WebAuthn testability answer", async () => {
        // Production identity = WebAuthn passkey → hash → ZEN keypair. There is
        // no authenticator in a headless test, so the credential hash is stood
        // in for by a fixed seed — the DERIVATION is identical: ZEN.pair(seed)
        // is deterministic, so the same credential always yields the same
        // public key, and a challenge-sign round-trip recovers the author.
        const credentialHash = "webauthn-credential-hash-for-alice"
        const a = await ZEN.pair(null, { seed: credentialHash })
        const b = await ZEN.pair(null, { seed: credentialHash })
        assert.equal(a.pub, b.pub, "same credential → same public key, every time")
        assert.notEqual(a.pub, (await ZEN.pair(null, { seed: "someone-else" })).pub)

        // The deferred server-mode flow (docs/authn-design.md §1): server issues
        // a nonce, client signs it, server recovers the pub → that IS the user.
        const nonce = "server-challenge-" + Date.now()
        const signature = await ZEN.sign(nonce, a)
        assert.equal(await ZEN.recover(signature), a.pub, "recover(sign(nonce)) === the author's pub")
        assert.equal(await ZEN.verify(signature, a.pub), nonce, "and the signed message is exactly the nonce")
    })

    Test.it("AUTH-05 session tokens: HMAC round-trip, tamper rejected, expiry rejected", () => {
        const secret = "site-secret"
        const token = issueToken({ user: "0PUBKEY", roles: ["admin"] }, secret, 60000, 1000)
        assert.deepEqual(verifyToken(token, secret, 2000), { user: "0PUBKEY", roles: ["admin"] })
        assert.equal(verifyToken(token, "wrong-secret", 2000), null, "a different secret never verifies")
        assert.equal(verifyToken(token + "x", secret, 2000), null, "a tampered token is rejected")
        assert.equal(verifyToken(token, secret, 999999), null, "an expired token is rejected")
        assert.equal(verifyToken("not.a.token", secret), null)
        assert.equal(verifyToken("garbage", secret), null)
    })

    Test.it("AUTH-06 verifyChallenge: a signature over the nonce proves the key; nothing else does", async () => {
        const pair = await ZEN.pair(null, { seed: "auth-06-user" })
        const nonce = "server-nonce-123"
        const signature = await ZEN.sign(nonce, pair)
        assert.equal(await verifyChallenge(pair.pub, nonce, signature), true)
        assert.equal(await verifyChallenge(pair.pub, "different-nonce", signature), false, "must sign THIS nonce")
        const impostor = await ZEN.pair(null, { seed: "someone-else" })
        assert.equal(await verifyChallenge(impostor.pub, nonce, signature), false, "another pub cannot claim the sig")
        assert.equal(await verifyChallenge(pair.pub, nonce, "garbage"), false)
    })

    Test.it("AUTH-07 E2E: challenge → sign → token → authorized request; role-mapped identity gets its policies", async () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-zen-auth-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const instance = join(scratch, "shop")
        const admin = await ZEN.pair(null, { seed: "the-admin-passkey" })
        const stranger = await ZEN.pair(null, { seed: "a-stranger" })

        // App policy: only the admin ROLE may create; everyone reads own rows
        mkdirSync(join(instance, "apps", "starter", "permissions"), { recursive: true })
        writeFileSync(
            join(instance, "apps", "starter", "permissions", "base.json"),
            JSON.stringify([
                { entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: true },
                { entity: "task", actions: ["read", "create", "write", "delete"], rule: null, permlevel: 0, ifOwner: false, roles: ["admin"] }
            ])
        )
        // config maps the admin's ZEN pub → admin role; token secret fixed
        const configPath = join(instance, "nexus.config.json")
        const config = JSON.parse(readFileSync(configPath, "utf8"))
        config.token_secret = "fixed-test-secret"
        config.identities = [{ pub: admin.pub, roles: ["admin"] }]
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
            const post = async (path, bodyObj, token) => {
                const r = await fetch(base + path, {
                    method: "POST",
                    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
                    body: JSON.stringify(bodyObj ?? {})
                })
                return { status: r.status, body: await r.json() }
            }
            const login = async (pair) => {
                const { body: chal } = await post("/api/v1/_auth/challenge", {})
                const signature = await ZEN.sign(chal.data.nonce, pair)
                const { body: verified } = await post("/api/v1/_auth/verify", { pub: pair.pub, nonce: chal.data.nonce, signature })
                return verified.data
            }

            // no token → 401
            assert.equal((await post("/api/v1/task", { title: "x" })).status, 401)

            // admin logs in via ZEN handshake → gets admin role → may create
            const adminSession = await login(admin)
            assert.deepEqual(adminSession.roles, ["admin"])
            const created = await post("/api/v1/task", { title: "admin made this" }, adminSession.token)
            assert.equal(created.status, 201)
            assert.equal(created.body.data.owner, admin.pub, "identity is the ZEN pub, cryptographically proven")

            // a stranger logs in (valid key, unmapped) → baseline only → cannot create
            const strangerSession = await login(stranger)
            assert.deepEqual(strangerSession.roles, [], "an unmapped identity gets no roles")
            const denied = await post("/api/v1/task", { title: "nope" }, strangerSession.token)
            assert.equal(denied.status, 403, "baseline policy has no create")

            // a replayed nonce cannot mint a second token
            const { body: chal } = await post("/api/v1/_auth/challenge", {})
            const sig = await ZEN.sign(chal.data.nonce, admin)
            assert.equal((await post("/api/v1/_auth/verify", { pub: admin.pub, nonce: chal.data.nonce, signature: sig })).status, 200)
            assert.equal((await post("/api/v1/_auth/verify", { pub: admin.pub, nonce: chal.data.nonce, signature: sig })).status, 401, "nonce is one-time")

            // a forged token (wrong secret) is refused
            const forged = issueToken({ user: admin.pub, roles: ["admin"] }, "guessed-secret")
            assert.equal((await post("/api/v1/task", { title: "forged" }, forged)).status, 401)
        } finally {
            await new Promise((resolve) => { dev.once("exit", resolve); dev.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
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
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
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
            await new Promise((resolve) => { dev.once("exit", resolve); dev.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })
})
