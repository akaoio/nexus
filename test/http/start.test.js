/**
 * Production server conformance (START-*) — `nexus start`. The security
 * contract is the whole point: production must NEVER serve the wide-open DEV
 * identity, must require TLS (or an explicit opt-out), must enforce auth, and
 * must not expose the Studio or framework source. Spawned as a real process.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

function scaffold({ withAuth = false, withPolicies = false } = {}) {
    const scratch = mkdtempSync(join(tmpdir(), "nexus-start-"))
    spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
    const instance = join(scratch, "shop")
    if (withPolicies) {
        mkdirSync(join(instance, "apps", "starter", "permissions"), { recursive: true })
        writeFileSync(
            join(instance, "apps", "starter", "permissions", "base.json"),
            JSON.stringify([{ entity: "task", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: false, roles: ["admin"] }])
        )
    }
    if (withAuth) {
        const configPath = join(instance, "nexus.config.json")
        const config = JSON.parse(readFileSync(configPath, "utf8"))
        config.token_secret = "fixed-start-secret"
        config.api_keys = [{ key: "k-admin", user: "alice", roles: ["admin"] }]
        writeFileSync(configPath, JSON.stringify(config, null, 4))
    }
    return { scratch, instance }
}

/** Spawn `nexus start --json` and resolve its ready {url}, or reject. */
function startServer(instance, extraArgs = []) {
    const proc = spawn(process.execPath, [BIN, "start", "--json", "--port", "0", ...extraArgs], { cwd: instance })
    const ready = new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("start did not come up")), 6000)
        let buffer = ""
        proc.stdout.on("data", (chunk) => {
            buffer += chunk
            try {
                const parsed = JSON.parse(buffer)
                clearTimeout(timer)
                parsed.ok ? resolve(parsed.url) : reject(new Error(parsed.code || "start failed"))
            } catch {}
        })
        proc.on("exit", () => reject(new Error("start exited early")))
    })
    return { proc, ready }
}

Test.describe("Production server — nexus start (START)", () => {
    Test.it("START-01 refuses to run with no auth configured — never the DEV god-mode", () => {
        const { scratch, instance } = scaffold({ withAuth: false })
        const r = spawnSync(process.execPath, [BIN, "start", "--json", "--port", "0", "--insecure"], { cwd: instance, encoding: "utf8" })
        assert.notEqual(r.status, 0)
        const out = JSON.parse(r.stdout)
        assert.equal(out.ok, false)
        assert.equal(out.code, "E_NO_AUTH")
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("START-02 refuses to run without TLS unless --insecure is explicit", () => {
        const { scratch, instance } = scaffold({ withAuth: true })
        const r = spawnSync(process.execPath, [BIN, "start", "--json", "--port", "0"], { cwd: instance, encoding: "utf8" })
        assert.notEqual(r.status, 0)
        const out = JSON.parse(r.stdout)
        assert.equal(out.ok, false)
        assert.equal(out.code, "E_NO_TLS")
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("START-03 with auth + --insecure: enforces auth, exposes no Studio/framework, serves /_health", async () => {
        const { scratch, instance } = scaffold({ withAuth: true, withPolicies: true })
        const { proc, ready } = startServer(instance, ["--insecure"])
        try {
            const base = await ready
            const call = (method, path, body, key) =>
                fetch(base + path, { method, headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: body && JSON.stringify(body) })

            assert.equal((await call("GET", "/_health")).status, 200)
            // auth enforced — no key is 401 before anything else
            assert.equal((await call("GET", "/api/v1/task")).status, 401)
            assert.equal((await call("POST", "/api/v1/task", { title: "x" })).status, 401)
            // a valid key passes auth (201 create, gated by app policy)
            const created = await call("POST", "/api/v1/task", { title: "prod row" }, "k-admin")
            assert.equal(created.status, 201)
            // NO Studio index, NO framework source in production
            assert.equal((await call("GET", "/")).status, 404)
            assert.equal((await call("GET", "/_nexus/src/core/UI.js")).status, 404)
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("START-04 with a TLS certificate: serves HTTPS", async () => {
        const openssl = spawnSync("openssl", ["version"], { encoding: "utf8" })
        if (openssl.status !== 0) {
            assert.equal(true, true) // openssl absent — HTTPS boundary not exercised here
            return
        }
        const { scratch, instance } = scaffold({ withAuth: true, withPolicies: true })
        mkdirSync(join(instance, ".certs"), { recursive: true })
        const keyPath = join(instance, ".certs", "key.pem")
        const certPath = join(instance, ".certs", "cert.pem")
        spawnSync("openssl", ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath, "-days", "1", "-nodes", "-subj", "/CN=localhost"], { stdio: "ignore" })
        assert.truthy(existsSync(keyPath) && existsSync(certPath))

        const prev = process.env.NODE_TLS_REJECT_UNAUTHORIZED
        process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0" // trust the self-signed cert for this test
        const { proc, ready } = startServer(instance)
        try {
            const base = await ready
            assert.truthy(base.startsWith("https://"), `expected https, got ${base}`)
            const health = await fetch(base + "/_health")
            assert.equal(health.status, 200)
            assert.equal((await health.json()).data.status, "ok")
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            if (prev === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED
            else process.env.NODE_TLS_REJECT_UNAUTHORIZED = prev
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })
})
