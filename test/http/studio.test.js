/**
 * Studio write endpoints conformance (STUDIO-*) — the dev-only /_studio routes
 * that persist a content type or permission set edited in the admin UI. Schema
 * editing is a DEV activity (Strapi parity); `nexus start` never exposes these.
 * Spawned as a real dev server; the write is verified on disk.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { validate } from "../../src/core/Model.js"
import { STUDIO_ACCESS, STUDIO_ROUTE_PATHS, accessFor } from "../../src/cli/dev-access.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))
const ZEN = (await import("../../vendor/zen/zen.js")).default

const scratch = mkdtempSync(join(tmpdir(), "nexus-studio-"))
spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
const instance = join(scratch, "shop")
let server = null
let base = null

async function ensure() {
    if (base) return base
    server = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: instance })
    base = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev did not start")), 6000)
        let buf = ""
        server.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
        server.on("exit", () => reject(new Error("dev exited early")))
    })
    return base
}
const post = async (path, body) => {
    const r = await fetch((await ensure()) + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    return { status: r.status, body: await r.json() }
}
const patch = async (path, body) => {
    const r = await fetch((await ensure()) + path, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
    return { status: r.status, body: await r.json() }
}

// STUDIO-08/09/10 (issue #9 C4): the gate must AUTHORIZE, not merely
// authenticate — a second, auth-ON instance with two PROVISIONED ZEN
// identities (admin, viewer). The /_studio gate reads Bearer session
// tokens (never x-nexus-key/api_keys), so authorization here is exercised
// through the real ZEN handshake (mirrors AUTH-07), not raw API keys.
const authScratch = mkdtempSync(join(tmpdir(), "nexus-studio-auth-"))
spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: authScratch })
const authInstance = join(authScratch, "shop")
const adminPair = await ZEN.pair(null, { seed: "studio-auth-admin" })
const viewerPair = await ZEN.pair(null, { seed: "studio-auth-viewer" })
const authCfgPath = join(authInstance, "nexus.config.json")
const authCfg = JSON.parse(readFileSync(authCfgPath, "utf8"))
authCfg.token_secret = "fixed-studio-auth-secret"
authCfg.identities = [{ pub: adminPair.pub, roles: ["admin"] }, { pub: viewerPair.pub, roles: ["viewer"] }]
writeFileSync(authCfgPath, JSON.stringify(authCfg, null, 4))

let authServer = null
let authBase = null
async function ensureAuth() {
    if (authBase) return authBase
    authServer = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: authInstance })
    authBase = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev did not start")), 6000)
        let buf = ""
        authServer.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
        authServer.on("exit", () => reject(new Error("dev exited early")))
    })
    return authBase
}
const tokenCache = new Map()
async function loginAs(pair) {
    const base = await ensureAuth()
    const chal = await (await fetch(base + "/api/v1/_auth/challenge", { method: "POST" })).json()
    const signature = await ZEN.sign(chal.data.nonce, pair)
    const verified = await (await fetch(base + "/api/v1/_auth/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ pub: pair.pub, nonce: chal.data.nonce, signature })
    })).json()
    return verified.data.token
}
async function callAs(pair, method, path, body) {
    if (!tokenCache.has(pair)) tokenCache.set(pair, await loginAs(pair))
    const r = await fetch((await ensureAuth()) + path, {
        method,
        headers: { "content-type": "application/json", authorization: `Bearer ${tokenCache.get(pair)}` },
        body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: r.status, body: await r.json() }
}
const ADMIN = adminPair
const VIEWER = viewerPair

Test.describe("Studio write endpoints (STUDIO)", () => {
    Test.it("STUDIO-01 POST /_studio/model persists a valid, validated content type", async () => {
        const r = await post("/_studio/model", { name: "customer", fields: [{ name: "email", type: "text", required: true }] })
        assert.equal(r.status, 200)
        assert.equal(r.body.ok, true)
        const file = join(instance, "apps", "starter", "models", "customer.json")
        assert.truthy(existsSync(file), "the model file is written to the app")
        const saved = JSON.parse(readFileSync(file, "utf8"))
        assert.equal(saved.name, "customer")
        assert.equal(validate(saved).valid, true) // what we persist is a valid Model Schema v1
    })

    Test.it("STUDIO-02 an invalid collection name is rejected (E_NAME), nothing written", async () => {
        const r = await post("/_studio/model", { name: "Bad Name!", fields: [] })
        assert.equal(r.status, 400)
        assert.equal(r.body.ok, false)
        assert.equal(r.body.error.code, "E_NAME")
        assert.falsy(existsSync(join(instance, "apps", "starter", "models", "Bad Name!.json")))
    })

    Test.it("STUDIO-03 an invalid schema is rejected (E_INVALID) by the Model API", async () => {
        const r = await post("/_studio/model", { name: "broken", fields: [{ name: "x", type: "not_a_type" }] })
        assert.equal(r.status, 400)
        assert.equal(r.body.error.code, "E_INVALID")
    })

    Test.it("STUDIO-04 the bespoke permissions write path is DEAD — /_studio/permissions 404s both ways", async () => {
        const g = await fetch((await ensure()) + "/_studio/permissions")
        assert.equal(g.status, 404)
        const p = await post("/_studio/permissions", { policies: [] })
        assert.equal(p.status, 404)
    })

    Test.it("STUDIO-05 /_studio/config reads (redacted) and writes a dot-path", async () => {
        await post("/_studio/config", { key: "token_secret", value: "sekret" }) // seed a secret
        const got = await post("/_studio/config", { key: "site.locale", value: "vi" })
        assert.equal(got.status, 200)
        assert.equal(got.body.ok, true)
        const cfg = JSON.parse(readFileSync(join(instance, "nexus.config.json"), "utf8"))
        assert.equal(cfg.site.locale, "vi")
        // GET is redacted
        const list = await (await fetch((await ensure()) + "/_studio/config")).json()
        assert.equal(list.data.config.token_secret, "***")
    })

    Test.it("STUDIO-06 GET /_studio/policies is the engine's own layers; a row created via the plane appears under rows", async () => {
        const created = await post("/api/v1/nexus_policy", {
            entity: "task", actions: JSON.stringify(["read"]), rule: null,
            permlevel: 0, ifowner: false, roles: JSON.stringify(["viewer"])
        })
        assert.equal(created.body.ok, true)
        const id = created.body.data.id
        const w = await fetch((await ensure()) + "/_studio/policies").then((r) => r.json())
        assert.equal(w.ok, true)
        const sources = w.data.layers.map((l) => l.source)
        assert.truthy(sources.includes("system") && sources.includes("admin") && sources.includes("rows"))
        const rows = w.data.layers.find((l) => l.source === "rows")
        assert.equal(rows.readonly, false)
        assert.truthy(rows.policies.some((p) => p.id === id && p.entity === "task"))
        for (const layer of w.data.layers) if (layer.source !== "rows") assert.equal(layer.readonly, true)
        assert.equal(typeof w.data.devMode, "boolean")
    })

    Test.it("STUDIO-07 an invalid nexus_policy row is VETOED at the plane — same law for every writer", async () => {
        const bad = await post("/api/v1/nexus_policy", { entity: "task", actions: JSON.stringify(["fly"]), rule: null, permlevel: 0, ifowner: false })
        assert.equal(bad.body.ok, false)
        assert.equal(bad.body.error.code, "E_INVALID")
        const broken = await post("/api/v1/nexus_policy", { entity: "task", actions: "{not json", rule: null, permlevel: 0, ifowner: false })
        assert.equal(broken.body.ok, false)

        // the UPDATE before-hook validates the MERGED row (current + patch),
        // not the patch alone — same law, proven through the other write path
        const valid = await post("/api/v1/nexus_policy", { entity: "task", actions: JSON.stringify(["read"]), rule: null, permlevel: 0, ifowner: false })
        assert.equal(valid.body.ok, true)
        const rowId = valid.body.data.id
        const vetoed = await patch(`/api/v1/nexus_policy/${rowId}`, { actions: JSON.stringify(["fly"]) })
        assert.equal(vetoed.body.ok, false)
        assert.equal(vetoed.body.error.code, "E_INVALID")
        const allowed = await patch(`/api/v1/nexus_policy/${rowId}`, { actions: JSON.stringify(["read", "create"]) })
        assert.equal(allowed.body.ok, true)
    })

    Test.it("STUDIO-08 a non-admin is refused every /_studio write and every state-exposing read", async () => {
        for (const [method, path, body] of [
            ["POST", "/_studio/model", { name: "sneaky", fields: [{ name: "x", type: "text" }] }],
            ["POST", "/_studio/config", { key: "token_secret", value: "stolen" }],
            ["GET", "/_studio/entities", undefined],
            ["GET", "/_studio/policies", undefined]
        ]) {
            const r = await callAs(VIEWER, method, path, body)
            assert.equal(r.status, 403, `${method} ${path}`)
            assert.equal(r.body.error.code, "E_FORBIDDEN")
        }
        assert.equal((await callAs(ADMIN, "GET", "/_studio/entities")).status, 200) // admin unaffected
    })

    Test.it("STUDIO-09 /_studio/session stays open to any authenticated user", async () => {
        assert.equal((await callAs(VIEWER, "GET", "/_studio/session")).status, 200)
    })

    Test.it("STUDIO-09a the reason the gate excludes /_studio/session: an anonymous caller (pre-login, no token) can probe whoami", async () => {
        // the login UI must be able to ask "is auth on?" before it holds any token
        const anon = await fetch((await ensureAuth()) + "/_studio/session")
        assert.equal(anon.status, 200)
        const body = await anon.json()
        assert.equal(body.data.user, null)
        assert.deepEqual(body.data.roles, [])
        assert.equal(typeof body.data.authRequired, "boolean")
    })

    Test.it("STUDIO-10 INVARIANT: every /_studio route dev.js actually handles is declared in STUDIO_ACCESS; undeclared is admin-only", () => {
        // The old form of this clause looped `for (const path of
        // STUDIO_ROUTE_PATHS) assert.truthy(accessFor(path))` — but
        // STUDIO_ROUTE_PATHS IS `Object.keys(STUDIO_ACCESS)`, and accessFor
        // reads that same table, so the loop asserted the table agrees with
        // itself. It could not fail if dev.js grew a new route and forgot to
        // declare it here (exactly the drift item 3 exists to catch). This
        // version derives the route set from dev.js's OWN source text —
        // every literal `"/_studio/…"` path it branches on — and checks each
        // one is declared, so a new undeclared route makes this test RED.
        const devPath = fileURLToPath(new URL("../../src/cli/commands/dev.js", import.meta.url))
        const devSource = readFileSync(devPath, "utf8")
        const handledRoutes = new Set([...devSource.matchAll(/"(\/_studio\/[a-z-]+)"/g)].map((m) => m[1]))
        assert.truthy(handledRoutes.size >= STUDIO_ROUTE_PATHS.length, "the source scan found at least the declared routes")
        for (const path of handledRoutes) assert.truthy(path in STUDIO_ACCESS, `${path} is handled in dev.js but not declared in STUDIO_ACCESS`)
        assert.equal(accessFor("/_studio/nonexistent"), "admin", "an undeclared route is admin-only")
        assert.equal(accessFor("/_studio/session"), "any", "the declared exception is honoured")
    })

    Test.it("STUDIO-11 /_studio/session resolves roles from the LIVE directory, not the token's stale claims (issue #9 final review, item 1)", async () => {
        // VIEWER already holds a cached session token whose CLAIMS carry
        // roles: ["viewer"] (baked in at issue time). An admin now clears
        // that identity's roles in the directory through the ordinary plane
        // API — the SAME token must immediately start answering with the
        // LIVE roles, exactly like the /_studio gate already did; if
        // /_studio/session instead echoed the token's own claims, a route
        // that trusts this response (the /users profile-save flow) would act
        // on a lie about a caller whose access was just revoked.
        const directory = await callAs(ADMIN, "GET", "/api/v1/nexus_user")
        assert.equal(directory.status, 200)
        const viewerRow = directory.body.data.find((r) => r.pub === VIEWER.pub)
        assert.truthy(viewerRow, "the viewer's directory row is visible to the admin")
        const cleared = await callAs(ADMIN, "PATCH", `/api/v1/nexus_user/${viewerRow.id}`, { roles: JSON.stringify([]) })
        assert.equal(cleared.status, 200, "the admin can clear another identity's roles")
        const session = await callAs(VIEWER, "GET", "/_studio/session")
        assert.equal(session.status, 200)
        assert.deepEqual(session.body.data.roles, [], "the SAME token now reports the live (empty) roles, not its stale claims")
    })

    Test.it("STUDIO-12 /_studio/users add provisions an identity that can actually log in (issue #9 final review, item 2)", async () => {
        // Before the fix, POST /_studio/users {action: "add"} wrote ONLY to
        // nexus.config.json. Past first boot (this instance already has
        // admin+viewer in the directory) that config identity is INERT:
        // knownPub/rolesForPub only fall back to config while the directory
        // is empty — so the new identity's handshake would 401 E_AUTH even
        // though the route answered applied: true. Prove the opposite: add
        // through the Studio, then complete the REAL ZEN handshake as that
        // brand-new identity and confirm it receives a working token.
        const freshPair = await ZEN.pair(null, { seed: "studio-auth-provisioned" })
        const added = await callAs(ADMIN, "POST", "/_studio/users", { action: "add", pub: freshPair.pub, name: "fresh", roles: ["viewer"] })
        assert.equal(added.status, 200)
        assert.equal(added.body.data.applied, true)
        const token = await loginAs(freshPair)
        assert.equal(typeof token, "string")
        assert.truthy(token.length > 0, "the freshly provisioned identity received a real session token")
        tokenCache.set(freshPair, token) // reuse the handshake above instead of logging in twice
        const whoami = await callAs(freshPair, "GET", "/_studio/session")
        assert.equal(whoami.status, 200)
        assert.equal(whoami.body.data.user, freshPair.pub)
        assert.deepEqual(whoami.body.data.roles, ["viewer"], "the role granted at provisioning time is live immediately")
    })

    Test.it("STUDIO-99 cleanup", async () => {
        if (server) await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        if (authServer) await new Promise((resolve) => { authServer.once("exit", resolve); authServer.kill("SIGKILL") })
        rmSync(authScratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        assert.equal(true, true)
    })
})
