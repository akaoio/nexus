/**
 * Production server conformance (START-*) — `nexus start`. The security
 * contract is the whole point: production must NEVER serve the wide-open DEV
 * identity, must require TLS (or an explicit opt-out), must enforce auth, and
 * must not expose the Studio or framework source. Spawned as a real process.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync, statSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { collectModules } from "../../src/cli/commands/studio.js"
import { STUDIO_ROUTE_PATHS, modesFor } from "../../src/cli/dev-access.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

// Build checks over our own source — NOT a JavaScript parser (same discipline
// as studio-build.test.js's walkJs/specifiersIn). Both are local to this
// file: they gate two structural invariants, not general-purpose tooling.

/** Every .js file under a directory, recursively. */
function* walkJs(dir) {
    const root = dir instanceof URL ? fileURLToPath(dir) : dir
    for (const name of readdirSync(root)) {
        const path = join(root, name)
        if (statSync(path).isDirectory()) yield* walkJs(path)
        else if (path.endsWith(".js")) yield path
    }
}

/** Every name passed to `ctx.api.studio("<name>", …)` in a source string. */
function studioCallNames(src) {
    const names = []
    const re = /ctx\.api\.studio\(\s*["']([^"']+)["']/g
    let m
    while ((m = re.exec(src))) names.push(m[1])
    return names
}

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
            // START-EVT: the dev-only event stream is never mounted in production
            assert.equal((await call("GET", "/__dev_events")).status, 404)
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("START-SECRET production refuses to boot without token_secret", () => {
        const { scratch, instance } = scaffold({ withAuth: false })
        const configPath = join(instance, "nexus.config.json")
        const config = JSON.parse(readFileSync(configPath, "utf8"))
        config.api_keys = [{ key: "k-admin", user: "alice", roles: ["admin"] }] // auth configured, secret is not
        writeFileSync(configPath, JSON.stringify(config, null, 4))
        const r = spawnSync(process.execPath, [BIN, "start", "--json", "--port", "0", "--insecure"], { cwd: instance, encoding: "utf8" })
        assert.equal(r.status !== 0, true)
        assert.truthy((r.stdout + r.stderr).includes("E_NO_SECRET"))
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("START-BODY the pre-auth verify endpoint refuses an oversized body", async () => {
        const { scratch, instance } = scaffold({ withAuth: true, withPolicies: true })
        const { proc, ready } = startServer(instance, ["--insecure"])
        try {
            const base = await ready
            const huge = "x".repeat(2 * 1024 * 1024)
            const r = await fetch(base + "/api/v1/_auth/verify", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ pub: huge })
            })
            assert.equal(r.status, 413)
            const body = await r.json()
            assert.equal(body.error.code, "E_BODY_SIZE")
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("START-CHALLENGE the challenge map is capped and sweeps expiries", async () => {
        const { scratch, instance } = scaffold({ withAuth: true, withPolicies: true })
        const { proc, ready } = startServer(instance, ["--insecure"])
        try {
            const base = await ready
            const post = (path, body) =>
                fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
            for (let i = 0; i < 1100; i++) await post("/api/v1/_auth/challenge", {})
            const r = await post("/api/v1/_auth/challenge", {})
            assert.equal(r.status, 503, "past the cap the server must refuse, not keep growing the map")
            const body = await r.json()
            assert.equal(body.error.code, "E_BUSY")
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("START-SESSION production serves /api/v1/_session; anonymous gets the minimum, a member gets live roles", async () => {
        const { scratch, instance } = scaffold({ withAuth: true, withPolicies: true })
        const { proc, ready } = startServer(instance, ["--insecure"])
        try {
            const base = await ready
            const call = (method, path, body, key) =>
                fetch(base + path, { method, headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) }, body: body && JSON.stringify(body) })

            const anon = await call("GET", "/api/v1/_session")
            assert.equal(anon.status, 200)
            const a = (await anon.json()).data
            assert.equal(a.user, null)
            assert.deepEqual(a.roles, [])
            assert.equal(typeof a.authRequired, "boolean")
            const mine = (await (await call("GET", "/api/v1/_session", undefined, "k-admin")).json()).data
            assert.deepEqual(mine.roles, ["admin"])
            // and the dev-only path is gone from production
            assert.equal((await call("GET", "/_studio/session")).status, 404)
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("START-POLICY-LAYERS production serves GET /api/v1/_policy-layers — the permissions page needs it there too", async () => {
        const { scratch, instance } = scaffold({ withAuth: true, withPolicies: true })
        const { proc, ready } = startServer(instance, ["--insecure"])
        try {
            const base = await ready
            const call = (method, path, key) =>
                fetch(base + path, { method, headers: { "content-type": "application/json", ...(key ? { authorization: `Bearer ${key}` } : {}) } })

            const admin = await call("GET", "/api/v1/_policy-layers", "k-admin")
            assert.equal(admin.status, 200)
            const sources = (await admin.json()).data.layers.map((l) => l.source)
            assert.truthy(sources.includes("system") && sources.includes("admin") && sources.includes("rows"))
            // no credential at all — the ordinary auth boundary refuses first
            assert.equal((await call("GET", "/api/v1/_policy-layers")).status, 401)
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("START-STUDIO with a built Studio, production serves the shell for Studio routes and its assets", async () => {
        const { scratch, instance } = scaffold({ withAuth: true, withPolicies: true })
        spawnSync(process.execPath, [BIN, "studio", "build"], { cwd: instance })
        const { proc, ready } = startServer(instance, ["--insecure"])
        try {
            const base = await ready
            assert.equal((await fetch(base + "/users")).status, 200) // a Studio route → the shell
            const html = await (await fetch(base + "/users")).text()
            // the ACTUAL built shell (shell.js's studioIndex) embeds boot data in
            // <script id="nx-boot">, not any "<nx-…>" custom element — those are
            // created by app.js at RUNTIME, not present in the served markup
            assert.truthy(html.includes("nx-boot"))
            // assets — the real build layout preserves the package path
            // (public/studio/src/studio/app.js), verified against the actual
            // `nexus studio build` output rather than assumed
            assert.equal((await fetch(base + "/studio/src/studio/app.js")).status, 200)
            assert.equal((await fetch(base + "/_nexus/src/core/UI.js")).status, 404) // never framework source
            assert.equal((await fetch(base + "/nope.js")).status, 404) // file-looking paths never reach the shell
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("START-STUDIO-BOOTABLE the shell served at a NESTED route resolves its OWN asset refs (a browser can boot it)", async () => {
        // START-STUDIO proved the shell serves (200) and the asset exists at
        // its real URL (200) — but NEVER that the shell's OWN references
        // resolve when it is served at a nested route. A "./"-relative ref
        // resolves against the ROUTE, not the origin, so at /settings/ai it
        // fetches /settings/src/studio/app.js → 404 → blank page. This clause
        // is that missing end-to-end check.
        const { scratch, instance } = scaffold({ withAuth: true, withPolicies: true })
        spawnSync(process.execPath, [BIN, "studio", "build"], { cwd: instance })
        const { proc, ready } = startServer(instance, ["--insecure"])
        try {
            const base = await ready
            // A REAL Studio route TWO segments deep (/settings/[feature],
            // feature "ai") — deep enough that a single-segment-relative bug
            // cannot accidentally pass.
            const route = "/settings/ai"
            const html = await (await fetch(base + route)).text()
            assert.truthy(html.includes("nx-boot"), "the shell is served at the nested route")
            const refs = [...html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)].map((m) => m[1])
            assert.truthy(
                refs.some((r) => r.endsWith(".js")) && refs.some((r) => r.endsWith(".css")),
                `the shell must reference its module + stylesheet; got ${JSON.stringify(refs)}`
            )
            for (const ref of refs) {
                // Resolve exactly as a browser does: against the REQUEST URL
                // (the nested route), NOT the origin root. "./src/…" from
                // /settings/ai → /settings/src/… (404); "/studio/src/…" → itself (200).
                const resolved = new URL(ref, base + route).href
                const res = await fetch(resolved)
                assert.equal(res.status, 200, `${ref} → ${resolved} must resolve when the shell is served at ${route}`)
                const type = res.headers.get("content-type") || ""
                assert.truthy(/javascript|css/.test(type), `${resolved} served as "${type}", expected a JS/CSS content-type`)
            }
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("START-STUDIO-ABSENT without a build, production has no Studio and says so with a 404", async () => {
        const { scratch, instance } = scaffold({ withAuth: true, withPolicies: true })
        const { proc, ready } = startServer(instance, ["--insecure"])
        try {
            const base = await ready
            assert.equal((await fetch(base + "/users")).status, 404)
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

/**
 * Structural invariants (PROD-*) — the boundary enforced by test, not
 * remembered. Two pin the production surface directly; one pins the exact
 * bug Task 4 fixed by hand so it cannot recur silently. Reuses the scaffold/
 * startServer harness above rather than standing up a second one.
 */
Test.describe("Production surface — structural invariants (PROD)", () => {
    Test.it("PROD-01 start.js never imports the dev module — the dev-only surface is unreachable, not merely unmounted", () => {
        // start.js's STATIC import graph; dev.js (and anything only it reaches)
        // must not appear — UNREACHABLE, not merely unmounted at runtime.
        const reached = collectModules(new URL("../../src/cli/commands/start.js", import.meta.url), { staticOnly: true })
        assert.equal(reached.some((f) => f.endsWith("commands/dev.js")), false)
        assert.equal(reached.some((f) => f.includes("HMR")), false, "no hot-reload machinery in production")
    })

    Test.it("PROD-02 production answers exactly the declared production route set", async () => {
        // Iterates ALL STUDIO_ROUTE_PATHS in both directions — a route wrongly
        // opened to production OR wrongly withheld from it fails this clause.
        const { scratch, instance } = scaffold({ withAuth: true, withPolicies: true })
        const { proc, ready } = startServer(instance, ["--insecure"])
        try {
            const base = await ready
            for (const path of STUDIO_ROUTE_PATHS) {
                const status = (await fetch(base + path)).status
                const declared = modesFor(path).includes("production")
                assert.equal(status !== 404, declared, `${path}: served=${status !== 404} declared=${declared}`)
            }
        } finally {
            await new Promise((resolve) => { proc.once("exit", resolve); proc.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })

    Test.it("PROD-03 every ctx.api.studio(name, …) call site names a declared studio route", () => {
        // Pins the exact bug Task 4 fixed by hand: the roles page once called
        // a deleted /_studio/permissions. Scans the whole src/studio/ tree,
        // not just routes/, since a violation could live anywhere in it.
        const declared = new Set(STUDIO_ROUTE_PATHS.map((p) => p.replace("/_studio/", "")))
        for (const file of walkJs(new URL("../../src/studio", import.meta.url))) {
            for (const name of studioCallNames(readFileSync(file, "utf8")))
                assert.truthy(declared.has(name), `${file} calls /_studio/${name}, not in the declared table`)
        }
    })
})
