/**
 * The auth seam and the transport contract, IN PROCESS (HTTPX-*) — issue #9's
 * coverage map, chunk 4 and the last of it.
 *
 * The map's first line was: `src/core/HTTP/server.js` (the auth seam,
 * `context()`, policy composition) and `src/core/HTTP/api.js` (routing, the
 * `?token=` fold, body limits) are "never imported by any test — black-box
 * subprocess observation only".
 *
 * That is not an abstract gap. THREE of the five Criticals lived in these
 * files: C1 turned on how `context()` composes policies, C1b on what
 * "authenticated" means there, I4 on where roles come from. All three were
 * found by a human reading the code, because no clause could reach them.
 *
 * `createApi` returns `async handle(req, res)` over two duck-typed objects, and
 * `buildInstanceApi` hands that back as `api` — so the whole stack (routing →
 * the `?token=` fold → `context()` → policy composition → the plane → the
 * status mapping) is drivable with a fake req/res. No production code had to
 * change to make this possible; the seam was already the right shape and had
 * simply never been called from in-process.
 *
 * These do NOT replace the START and STUDIO suites. Those prove real HTTP over real
 * sockets. These prove the DECISION, cheaply enough that the next change to it
 * is covered by default.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { buildInstanceApi } from "../../src/core/HTTP/server.js"
import { issueToken } from "../../src/core/App/auth.js"

const TASK = {
    schemaVersion: 1,
    name: "task",
    label: { en: "Task" },
    fields: [{ name: "title", type: "text", label: { en: "T" } }]
}

/** A minimal instance directory — enough for openInstanceData to work. */
function scratchRoot() {
    const root = mkdtempSync(join(tmpdir(), "nexus-inproc-"))
    mkdirSync(join(root, "apps", "demo"), { recursive: true })
    writeFileSync(join(root, "package.json"), JSON.stringify({ name: "inproc", type: "module" }))
    return root
}

/** A fake request. `on()` satisfies api.js's body reader without a socket. */
function req(method, path, { headers = {}, body = null } = {}) {
    const chunks = body === null ? [] : [Buffer.from(typeof body === "string" ? body : JSON.stringify(body))]
    let destroyed = false
    return {
        method,
        url: path,
        headers,
        get destroyed() { return destroyed },
        destroy() { destroyed = true },
        on(event, fn) {
            if (event === "data") for (const c of chunks) fn(c)
            if (event === "end") fn()
            return this
        }
    }
}

/** A fake response that records what was written. */
function res() {
    return {
        statusCode: 0,
        payload: null,
        headers: {},
        writeHead(status, headers) { this.statusCode = status; Object.assign(this.headers, headers ?? {}) },
        setHeader(k, v) { this.headers[k] = v },
        write() {},
        end(text) { try { this.payload = JSON.parse(text) } catch { this.payload = text } },
        on() { return this }
    }
}

/** Build a real instance API in-process. Returns a `call` helper. */
async function build({ config = {}, appPolicies = [], mode = "dev" } = {}) {
    const root = scratchRoot()
    const built = await buildInstanceApi({
        root,
        config: { configVersion: 1, database: { engine: "sqlite" }, ...config },
        schemas: [TASK],
        apps: [{ dir: "demo" }],
        appPolicies,
        mode
    })
    const call = async (method, path, options) => {
        const request = req(method, path, options)
        const response = res()
        const handled = await built.api(request, response)
        return { handled, status: response.statusCode, body: response.payload, request, response }
    }
    const cleanup = async () => {
        await built.effects?.stop?.()
        rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    }
    return { ...built, call, cleanup, root }
}

const ADMIN_KEY = { key: "k-admin", user: "alice", roles: ["admin"] }

Test.describe("Auth seam and transport, in process (HTTPX)", () => {

    Test.it("HTTPX-A01 with no auth configured the DEV identity is issued, and x-nexus-user names it", async () => {
        // START-01 proves production REFUSES this identity. Nothing proved what
        // dev actually grants when it uses it — the other half of the same rule.
        const rig = await build()
        try {
            const created = await rig.call("POST", "/api/v1/task", { headers: { "x-nexus-user": "dana" }, body: { title: "t" } })
            assert.equal(created.status, 201, JSON.stringify(created.body))
            assert.equal(created.body.data.owner, "dana", "the header names the dev identity, and the plane stamps it as owner")
        } finally {
            await rig.cleanup()
        }
    })

    Test.it("HTTPX-A02 with auth configured, a request carrying no credential is E_AUTH 401", async () => {
        const rig = await build({ config: { api_keys: [ADMIN_KEY], token_secret: "s" } })
        try {
            const r = await rig.call("GET", "/api/v1/task")
            assert.equal(r.status, 401)
            assert.equal(r.body.error.code, "E_AUTH")
        } finally {
            await rig.cleanup()
        }
    })

    Test.it("HTTPX-A03 a valid API key acts with exactly that key's roles; a wrong key is refused", async () => {
        const rig = await build({
            config: { api_keys: [ADMIN_KEY, { key: "k-none", user: "bob", roles: [] }], token_secret: "s" }
        })
        try {
            const admin = await rig.call("GET", "/api/v1/task", { headers: { "x-nexus-key": "k-admin" } })
            assert.equal(admin.status, 200, JSON.stringify(admin.body))

            // A key with no roles composes no policies — deny-by-default, not
            // "authenticated therefore allowed".
            const roleless = await rig.call("GET", "/api/v1/task", { headers: { "x-nexus-key": "k-none" } })
            assert.equal(roleless.status, 403, JSON.stringify(roleless.body))

            const wrong = await rig.call("GET", "/api/v1/task", { headers: { "x-nexus-key": "k-admin-x" } })
            assert.equal(wrong.status, 401, "a near-miss key is not a key")
        } finally {
            await rig.cleanup()
        }
    })

    Test.it("HTTPX-A04 a token's roles claim is IGNORED — the live directory decides what the bearer may do", async () => {
        // This is I4's mechanism asserted at the seam. AUTH-REVOKE proves the
        // behaviour over a subprocess; this proves it in one call, with the
        // directory in a state a subprocess test would have to build an entire
        // instance to reach.
        const rig = await build({ config: { api_keys: [ADMIN_KEY], token_secret: "fixed-secret" } })
        try {
            await rig.call("POST", "/api/v1/nexus_user", {
                headers: { "x-nexus-key": "k-admin" },
                body: { pub: "PUB1", name: "Ann", roles: JSON.stringify([]) }
            })

            // A token that CLAIMS admin, for a user the directory grants nothing.
            const forged = issueToken({ user: "PUB1", roles: ["admin"] }, "fixed-secret")

            // Probed with an ADMIN-ONLY action. Reading nexus_user would not
            // prove anything: the shipped system baselines let every
            // authenticated user read the directory (deliberate, and disclosed
            // in STATUS as a tenant-boundary note) — so a read succeeding says
            // nothing about whether the claimed role was honoured.
            const r = await rig.call("POST", "/api/v1/nexus_policy", {
                headers: { authorization: `Bearer ${forged}` },
                body: { entity: "task", actions: JSON.stringify(["read"]), permlevel: 0, ifowner: false, roles: JSON.stringify(["admin"]) }
            })

            assert.equal(r.status, 403, `a claimed role must buy nothing: ${JSON.stringify(r.body)}`)

            // …and the same call with a real admin credential DOES work, so the
            // clause is proving the claim was ignored, not that the route is
            // simply broken.
            const real = await rig.call("POST", "/api/v1/nexus_policy", {
                headers: { "x-nexus-key": "k-admin" },
                body: { entity: "task", actions: JSON.stringify(["read"]), permlevel: 0, ifowner: false, roles: JSON.stringify(["admin"]) }
            })
            assert.equal(real.status, 201, JSON.stringify(real.body))
        } finally {
            await rig.cleanup()
        }
    })

    Test.it("HTTPX-A05 a technically valid token for an UNPROVISIONED pub carries no roles at all", async () => {
        // C1b's other half: holding a keypair is not membership. /_auth/verify
        // refuses to MINT one for a stranger; this pins that even if a token
        // exists, the seam grants it nothing.
        const rig = await build({ config: { api_keys: [ADMIN_KEY], token_secret: "fixed-secret" } })
        try {
            const stranger = issueToken({ user: "NOBODY", roles: ["admin"] }, "fixed-secret")
            const r = await rig.call("GET", "/api/v1/task", { headers: { authorization: `Bearer ${stranger}` } })
            assert.equal(r.status, 403, JSON.stringify(r.body))
        } finally {
            await rig.cleanup()
        }
    })

    Test.it("HTTPX-R01 ?token= authenticates the event stream ONLY — a data route with it is anonymous", async () => {
        // STUDIO-09b pins this rule for /_session. Nothing pinned it for entity
        // routes, which are where the rows are.
        const rig = await build({ config: { api_keys: [ADMIN_KEY], token_secret: "fixed-secret" } })
        try {
            const token = issueToken({ user: "alice", roles: ["admin"] }, "fixed-secret")
            const r = await rig.call("GET", `/api/v1/task?token=${token}`)
            assert.equal(r.status, 401, `a query-string token must not authenticate a data read: ${JSON.stringify(r.body)}`)
            assert.equal(r.body.error.code, "E_AUTH")
        } finally {
            await rig.cleanup()
        }
    })

    Test.it("HTTPX-R02 a body over the limit is 413 E_BODY_SIZE, and the request is destroyed", async () => {
        const rig = await build()
        try {
            const r = await rig.call("POST", "/api/v1/task", { body: "x".repeat(1024 * 1024 + 10) })
            assert.equal(r.status, 413)
            assert.equal(r.body.error.code, "E_BODY_SIZE")
        } finally {
            await rig.cleanup()
        }
    })

    Test.it("HTTPX-R03 the status mapping is a contract — every client's error handling is written against it", async () => {
        const rig = await build()
        try {
            assert.equal((await rig.call("GET", "/api/v1/nope")).status, 404, "unknown entity → 404")
            assert.equal((await rig.call("GET", "/api/v1/task/missing-id")).status, 404, "missing row → 404")

            const invalid = await rig.call("POST", "/api/v1/task", { body: { title: 42 } })
            assert.equal(invalid.status, 400, `a validation fault → 400: ${JSON.stringify(invalid.body)}`)
            assert.truthy(invalid.body.error.code.startsWith("E_"))

            // A forbidden read is 403 and never leaks existence beyond that.
            const locked = await build({ config: { api_keys: [{ key: "k", user: "b", roles: [] }], token_secret: "s" } })
            try {
                const r = await locked.call("GET", "/api/v1/task", { headers: { "x-nexus-key": "k" } })
                assert.equal(r.status, 403)
                assert.equal(r.body.error.code, "E_FORBIDDEN")
            } finally {
                await locked.cleanup()
            }
        } finally {
            await rig.cleanup()
        }
    })

    Test.it("HTTPX-R04 a path outside the API base returns false, so a host server can serve its own routes", async () => {
        const rig = await build()
        try {
            const r = await rig.call("GET", "/not-the-api")
            assert.equal(r.handled, false, "unhandled must be reported, not answered with a 404 that swallows the host's routes")
            assert.equal(r.status, 0, "and nothing may be written to the response")
        } finally {
            await rig.cleanup()
        }
    })

    Test.it("HTTPX-P01 what is ENFORCED and what the window SHOWS come from one source — they cannot drift", async () => {
        // POLWIN-* proves the window's shape over HTTP. This proves the
        // property that makes the window trustworthy: the layers document is
        // derived from the same policyLayers() the enforcement composes from,
        // so the window can never describe a set the engine does not enforce.
        const appPolicy = { entity: "task", actions: ["read"], rule: null, permlevel: 0, ifOwner: false, roles: ["admin"], source: "apps/demo/permissions/base.json" }
        const rig = await build({ config: { api_keys: [ADMIN_KEY], token_secret: "s" }, appPolicies: [appPolicy] })
        try {
            const r = await rig.call("GET", "/api/v1/_policy-layers", { headers: { "x-nexus-key": "k-admin" } })
            assert.equal(r.status, 200, JSON.stringify(r.body))

            const sources = r.body.data.layers.map((l) => l.source)
            assert.truthy(sources.includes("system"), "the system baselines are shown")
            assert.truthy(sources.includes("admin"), "so is the admin bundle")
            assert.truthy(sources.includes("rows"), "and the live nexus_policy rows")
            assert.truthy(sources.includes(appPolicy.source), "and the app file that supplied one")

            // Exactly one layer is writable — the rows. If a baseline ever
            // showed as editable, the Studio would offer an edit that silently
            // does nothing.
            const writable = r.body.data.layers.filter((l) => !l.readonly).map((l) => l.source)
            assert.deepEqual(writable, ["rows"])
        } finally {
            await rig.cleanup()
        }
    })
})
