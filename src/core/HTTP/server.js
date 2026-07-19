/**
 * Shared instance API wiring — the single source of truth for turning a loaded
 * instance into an HTTP Data Plane API. Both `nexus dev` and `nexus start` build
 * their API here so the security-critical auth logic lives in ONE place.
 *
 * Auth model (docs/authn-design.md): configuring `api_keys` or `identities`
 * makes auth REQUIRED — a valid ZEN session token or API key, or 401. With
 * neither configured, `dev` falls back to a loud, wide-open DEV identity.
 * PRODUCTION MODE REFUSES THAT: mode "production" with no auth configured throws
 * E_NO_AUTH rather than serve the god-mode facing a network. There are no
 * half-modes.
 */

import { DataPlane } from "../Data.js"
import { profileFor } from "../App/models.js"
import { SYSTEM_ENTITIES, SYSTEM_BASELINES, adminBaselines, isSystem, validatePolicyRow, unpackPolicyRows, importIdentities } from "../App/system.js"
import { createApi } from "./api.js"
import { openInstanceData, ensureTables } from "../../cli/data.js"
import { loadExtensions } from "../App/extensions.js"
import { policiesFor } from "../App/policies.js"
import { enqueue, runnerTick } from "../App/jobs.js"
import { bindPlaneRpc, startJobThread } from "../App/jobthread.js"
import { verifyToken } from "../App/auth.js"
import { timingSafeStringEqual } from "../../cli/output.js"
import { ACTIONS } from "../Permission.js"
import { randomBytes } from "crypto"
import { join } from "path"

/**
 * A real transformers.js embedder that loads its model on FIRST use, so
 * enabling a semantic model never slows dev startup. Exposes the same
 * { name, embed, embedQuery } contract; dims resolve once the model is loaded.
 */
function lazyTransformers(model, root) {
    let inner = null
    const ensure = async () => {
        if (!inner) {
            const { transformersProvider } = await import("../Semantic/transformers.js")
            inner = await transformersProvider({ model, root })
        }
        return inner
    }
    return {
        name: model,
        version: 1,
        floor: profileFor(model).floor,
        nlThreshold: profileFor(model).nlThreshold,
        get dims() {
            return inner?.dims
        },
        async embed(texts) {
            return (await ensure()).embed(texts)
        },
        async embedQuery(texts) {
            const e = await ensure()
            return (e.embedQuery ?? e.embed)(texts)
        }
    }
}

/** The wide-open DEV policy set — every action, every permlevel (dev only). */
function devPolicies(schemas) {
    const policies = []
    for (const schema of schemas)
        for (let permlevel = 0; permlevel <= 9; permlevel++)
            policies.push({ entity: schema.name, actions: [...ACTIONS], rule: null, permlevel, ifOwner: false })
    return policies
}

/**
 * Build the Data Plane API + auth state for an instance.
 * @param {Object} args
 * @param {string} args.root - instance directory
 * @param {Object} args.config - nexus.config.json
 * @param {Array} args.schemas - Model Schema v1 documents
 * @param {Array} args.apps - loaded apps
 * @param {Array} args.appPolicies - policies contributed by apps
 * @param {"dev"|"production"} [args.mode="dev"]
 * @returns {Promise<{api, authState, challenges, engine, authMode, extensions}>}
 */
export async function buildInstanceApi({ root, config, schemas, apps, appPolicies = [], mode = "dev" }) {
    const extensions = await loadExtensions(root, apps)
    const authState = { required: false, secret: null, rolesForPub: () => [] }
    const challenges = new Map() // nonce → expiry (one-time, 60s)
    let api = null
    let plane = null
    let engine = "sqlite"
    let authMode = "no entities"
    let embedderInfo = { mode: "none", semanticAvailable: false }
    // The engine's own runtime layers, for the read-only policy window
    // (design 2026-07-19 §2). Reassigned below once `shippedAdmin`/`dbPolicies`
    // exist — kept live (function, not a snapshot) so a hot policy write is
    // visible on the very next call, no restart.
    let policyLayers = () => ({ app: appPolicies, system: SYSTEM_BASELINES, admin: [], rows: [] })
    // No-op until the runner starts below (schemas.length === 0 boots no
    // plane at all) — dev.js's hot-reload path can always call effects.stop().
    let effects = { stop: async () => {} }

    if (schemas.length) {
        // System entities join the SAME pipeline as app entities — user, role,
        // policy and saved views are ordinary documents (the Frappe lesson);
        // only the registry flag makes them undeletable in the Studio.
        const allSchemas = [...schemas, ...SYSTEM_ENTITIES]
        const data = await openInstanceData(root, config)
        engine = data.engine
        const { executor, kysely } = data
        await ensureTables(executor, kysely, allSchemas, executor.dialect)

        // Embeddings (§4.6b). Honest, opt-in, and lazy:
        //  • no entity declares `semantic:` → no embedder (mode "none").
        //  • `semantic.model` set in config AND transformers.js installed in the
        //    instance → a REAL ML model (loaded on first use, so dev boot stays
        //    fast); search/NL become semantic (mode "semantic").
        //  • otherwise → the deterministic LEXICAL provider (mode "lexical"),
        //    with the status telling you exactly how to enable a real model.
        const { hashProvider } = await import("../Semantic.js")
        let semanticAvailable = false
        try {
            const { createRequire } = await import("module")
            createRequire(join(root, "package.json")).resolve("@huggingface/transformers")
            semanticAvailable = true
        } catch {}
        const wantsSemantic = schemas.some((s) => s.semantic)
        const model = config.semantic?.model
        // Status/badge reflects the CONFIGURED model FIRST — so a model "in use"
        // never reads "no embedder" (that only means no model and nothing to
        // embed). `indexed` says whether any Entity actually declares `semantic:`.
        if (model && semanticAvailable) embedderInfo = { mode: "semantic", name: model, semanticAvailable: true, indexed: wantsSemantic }
        else if (model) embedderInfo = { mode: "lexical", name: "hash-bow", semanticAvailable, wanted: model }
        else if (wantsSemantic) embedderInfo = { mode: "lexical", name: "hash-bow", semanticAvailable }
        else embedderInfo = { mode: "none", semanticAvailable }
        // The Data Plane embedder exists only when an Entity is indexable
        // (declares `semantic:`) — nothing to embed otherwise. It uses the real
        // model when configured + installed, else the lexical fallback.
        let embedder = null
        if (wantsSemantic) embedder = model && semanticAvailable ? lazyTransformers(model, root) : hashProvider()

        // NL→AST (§4.6f), REAL: the deterministic rule grammar first (it wins
        // when the text parses), and past that the schema-derived intent
        // library retrieved by the REAL embedding model — "việc đã hoàn thành"
        // lands on done = true through vector similarity. Only when neither
        // understands does E_NL_PARSE surface (the Studio then falls to search).
        let nlProvider
        if (embedder && model && semanticAvailable) {
            const { ruleProvider, strictParse, embeddingNLProvider } = await import("../NL.js")
            const { intentsFor } = await import("../NL/intents.js")
            const intentProviders = new Map()
            // Tier 4 (opt-in via semantic.nlModel): a REAL local LLM composes
            // ASTs the grammar and intent retrieval cannot — loaded lazily,
            // its output still validated + permission-injected downstream.
            const nlModel = config.semantic?.nlModel
            let llm = null
            const llmProvider = async (query, { schema }) => {
                if (!llm) {
                    const { llmNLProvider, functionGemmaGenerator } = await import("../NL/llm.js")
                    llm = llmNLProvider({ generate: await functionGemmaGenerator({ model: nlModel, root }) })
                }
                return llm(query, { schema })
            }
            // A conjunction marks a COMPOUND ask — single-intent retrieval would
            // answer a fragment and silently drop the rest, so compounds go to
            // the LLM (which composes) and only fall back to intents after.
            const COMPOUND = /\bvà\b|\bhoặc\b|\bmà\b|\bnhưng\b|\band\b|\bor\b|\bbut\b|,/i
            const intentFor = (schema) => {
                let provider = intentProviders.get(schema.name)
                if (!provider) {
                    provider = embeddingNLProvider({ examples: intentsFor(schema), embedder, threshold: embedder.nlThreshold ?? 0.35 })
                    intentProviders.set(schema.name, provider)
                }
                return provider
            }
            nlProvider = async (query, { schema }) => {
                // A compound ask must not be answered by a FRAGMENT: the strict
                // grammar may parse it whole; failing that the LLM composes it;
                // natural/intent readings (one clause at a time) come last.
                if (nlModel && COMPOUND.test(query)) {
                    const strict = strictParse(query, schema)
                    if (strict) return strict
                    try {
                        return await llmProvider(query, { schema })
                    } catch {}
                }
                try {
                    return await ruleProvider(query, { schema })
                } catch (parseError) {
                    const stages = nlModel ? [intentFor(schema), llmProvider] : [intentFor(schema)]
                    for (const stage of stages) {
                        try {
                            return await stage(query, { schema })
                        } catch {}
                    }
                    throw parseError // the parser's message is the actionable one
                }
            }
        }
        plane = new DataPlane({ executor, schemas: allSchemas, dialect: executor.dialect, hooks: extensions, embedder, nlProvider })

        // ── the RBAC directory lives in the plane ─────────────────────────────
        // nexus_policy rows are the LIVE policy layer (app files stay shipped
        // baselines); nexus_user rows are the directory (many roles per user).
        // Both are cached here and refreshed through the SAME hook mechanism
        // apps use — a Studio write is instantly a live grant, no restart.
        const NEXUS_CTX = {
            user: "nexus", roles: [], shares: [],
            policies: ["nexus_policy", "nexus_user"].map((entity) => ({ entity, actions: ["read", "create"], rule: null, permlevel: 0, ifOwner: false }))
        }
        const dbPolicies = []
        const usersByPub = new Map()
        const refreshPolicies = async () => {
            const rows = await plane.list("nexus_policy", {}, NEXUS_CTX)
            const { policies, skipped } = unpackPolicyRows(rows)
            dbPolicies.length = 0
            dbPolicies.push(...policies)
            for (const bad of skipped)
                console.warn(`nexus_policy row ${bad.id} skipped (${bad.error}) — repair or delete it via /api/v1/nexus_policy`)
        }
        const refreshUsers = async () => {
            const rows = await plane.list("nexus_user", {}, NEXUS_CTX)
            usersByPub.clear()
            for (const row of rows) usersByPub.set(row.pub, { ...row, roles: row.roles ? JSON.parse(row.roles) : [] })
        }
        for (const event of ["after:create", "after:update", "after:remove"]) {
            extensions.hook("nexus_policy", event, () => refreshPolicies())
            extensions.hook("nexus_user", event, () => refreshUsers())
        }

        // write-side defense: a nexus_policy row must BE a valid policy —
        // before-hooks THROW to veto (App API contract), so an invalid row
        // never reaches the table, from the Studio or any API caller
        extensions.hook("nexus_policy", "before:create", (payload) => {
            const result = validatePolicyRow(payload.data, allSchemas)
            if (!result.valid) throw new Error("E_INVALID: " + JSON.stringify(result.errors))
        })
        extensions.hook("nexus_policy", "before:update", async (payload) => {
            const rows = await plane.list("nexus_policy", {}, NEXUS_CTX)
            const current = rows.find((r) => r.id === payload.id) ?? {}
            const result = validatePolicyRow({ ...current, ...payload.patch }, allSchemas)
            if (!result.valid) throw new Error("E_INVALID: " + JSON.stringify(result.errors))
        })

        const keys = Array.isArray(config.api_keys) ? config.api_keys : []
        // LIVE auth state: the user DIRECTORY (nexus_user rows) decides roles;
        // config identities remain the bootstrap seed and the lockout-proof
        // fallback. `required` derives live, so adding the first user (either
        // side) flips auth ON without a restart.
        authState.identities = Array.isArray(config.identities) ? [...config.identities] : [] // [{ pub, roles }]
        Object.defineProperty(authState, "required", { get: () => keys.length > 0 || authState.identities.length > 0 || usersByPub.size > 0 })
        authState.secret = config.token_secret || randomBytes(32).toString("hex") // ephemeral if unset
        authState.rolesForPub = (pub) => usersByPub.get(pub)?.roles ?? authState.identities.find((i) => i.pub === pub)?.roles ?? []

        // bootstrap: an empty directory imports the config identities ONCE —
        // from then on the table IS the truth the Studio edits
        await refreshUsers()
        if (!usersByPub.size && authState.identities.length) {
            for (const row of importIdentities(authState.identities)) await plane.create("nexus_user", row, NEXUS_CTX)
            await refreshUsers()
        }
        await refreshPolicies()

        // The one hard security rule of production mode: never serve god-mode.
        if (mode === "production" && !authState.required)
            throw Object.assign(
                new Error("E_NO_AUTH: production requires api_keys or identities in nexus.config.json — refusing to serve the wide-open DEV identity"),
                { code: "E_NO_AUTH" }
            )

        const devPols = devPolicies(allSchemas)
        // effective policy set = app-file baselines + nexus-shipped baselines
        // (self-service as DATA: $CURRENT_USER rules; the admin bundle over
        // every loaded entity — Frappe's System Manager) + LIVE nexus_policy rows
        const shippedAdmin = adminBaselines(allSchemas)
        // live array REFERENCES — the window is the engine's own truth, never a
        // disk re-read; appPolicies/dbPolicies mutate in place on hot reload
        policyLayers = () => ({ app: appPolicies, system: SYSTEM_BASELINES, admin: shippedAdmin, rows: dbPolicies })
        // The window and enforcement compose from the SAME source by construction: livePolicies derives from policyLayers.
        const livePolicies = () => Object.values(policyLayers()).flat()
        const context = (req) => {
            // spread per request: appPolicies + dbPolicies mutate live
            if (!authState.required)
                return { user: req.headers["x-nexus-user"] || "dev", roles: ["dev"], policies: [...devPols, ...appPolicies], shares: [] }
            const header = req.headers["authorization"] ?? ""
            const bearer = header.startsWith("Bearer ") ? header.slice(7) : null
            // 1) a ZEN session token (issued by /_auth/verify)
            if (bearer) {
                const claims = verifyToken(bearer, authState.secret)
                if (claims) return { user: claims.user, roles: claims.roles, policies: policiesFor(livePolicies(), claims.roles), shares: [] }
            }
            // 2) a static API key (constant-time, SEC-06)
            const presented = bearer ?? req.headers["x-nexus-key"]
            let entry = null
            for (const k of keys) if (k.key && timingSafeStringEqual(k.key, presented ?? "")) entry = k
            if (entry) {
                const roles = entry.roles ?? []
                return { user: entry.user, roles, policies: policiesFor(livePolicies(), roles), shares: [] }
            }
            throw new Error("E_AUTH: a valid session token or API key is required")
        }

        api = createApi({ plane, endpoints: extensions.endpoints, context })
        authMode = authState.required
            ? `${[keys.length && `${keys.length} API keys`, authState.identities.length && `${authState.identities.length} ZEN identities`].filter(Boolean).join(" + ")} (E_AUTH without credentials)`
            : "DEV identity — wide-open policies, user via x-nexus-user header"

        // ── the effect runner (design §2/§3): claims on main, executes in the
        // job THREAD, settles through the plane. Server-mode only — effects
        // never replicate (§6). JOB_CTX is deliberately not god-mode.
        const JOB_CTX = {
            user: "nexus-jobs", roles: [], shares: [],
            policies: [
                ...allSchemas.filter((s) => !isSystem(s.name)).map((s) => ({ entity: s.name, actions: [...ACTIONS], rule: null, permlevel: 0, ifOwner: false })),
                { entity: "nexus_job", actions: ["read", "create", "write"], rule: null, permlevel: 0, ifOwner: false },
                { entity: "nexus_notification", actions: ["read", "create"], rule: null, permlevel: 0, ifOwner: false },
                { entity: "nexus_webhook", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }
            ]
        }
        extensions.enqueue = (name, payload, opts) => enqueue(plane, JOB_CTX, name, payload, opts)
        bindPlaneRpc(plane, JOB_CTX)
        const jobThread = await startJobThread({ root, apps, builtins: [] }) // Task 6 wires effects.js here
        let draining = false
        const tick = async () => {
            if (draining) return
            draining = true
            try {
                while (await runnerTick(plane, { now: Date.now, jobs: extensions.jobs, execute: jobThread.execute, ctx: JOB_CTX })) {}
            } catch (error) {
                console.warn(`effect runner: tick failed (will retry next poll) — ${String(error?.message ?? error)}`)
            } finally {
                draining = false
            }
        }
        const poller = setInterval(tick, config.jobs?.poll_ms ?? 1000)
        effects = { stop: async () => { clearInterval(poller); await jobThread.stop() } }
    }

    return { api, plane, authState, challenges, engine, authMode, extensions, embedderInfo, policyLayers, effects }
}

export default { buildInstanceApi }
