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

import { DataPlane } from "../data/DataPlane.js"
import { createApi } from "./api.js"
import { openInstanceData, ensureTables } from "../cli/data.js"
import { loadExtensions } from "../app/Extensions.js"
import { policiesFor } from "../app/Policies.js"
import { verifyToken } from "../app/auth.js"
import { timingSafeStringEqual } from "../cli/output.js"
import { ACTIONS } from "../permission/Permission.js"
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
            const { transformersProvider } = await import("../semantic/transformers.js")
            inner = await transformersProvider({ model, root })
        }
        return inner
    }
    return {
        name: model,
        version: 1,
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
    let engine = "sqlite"
    let authMode = "no entities"
    let embedderInfo = { mode: "none", semanticAvailable: false }

    if (schemas.length) {
        const data = await openInstanceData(root, config)
        engine = data.engine
        const { executor, kysely } = data
        await ensureTables(executor, kysely, schemas, executor.dialect)

        // Embeddings (§4.6b). Honest, opt-in, and lazy:
        //  • no entity declares `semantic:` → no embedder (mode "none").
        //  • `semantic.model` set in config AND transformers.js installed in the
        //    instance → a REAL ML model (loaded on first use, so dev boot stays
        //    fast); search/NL become semantic (mode "semantic").
        //  • otherwise → the deterministic LEXICAL provider (mode "lexical"),
        //    with the status telling you exactly how to enable a real model.
        const { hashProvider } = await import("../semantic/semantic.js")
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
        const plane = new DataPlane({ executor, schemas, dialect: executor.dialect, hooks: extensions, embedder })

        const keys = Array.isArray(config.api_keys) ? config.api_keys : []
        const identities = Array.isArray(config.identities) ? config.identities : [] // [{ pub, roles }]
        authState.required = keys.length > 0 || identities.length > 0
        authState.secret = config.token_secret || randomBytes(32).toString("hex") // ephemeral if unset
        authState.rolesForPub = (pub) => identities.find((i) => i.pub === pub)?.roles ?? []

        // The one hard security rule of production mode: never serve god-mode.
        if (mode === "production" && !authState.required)
            throw Object.assign(
                new Error("E_NO_AUTH: production requires api_keys or identities in nexus.config.json — refusing to serve the wide-open DEV identity"),
                { code: "E_NO_AUTH" }
            )

        let context
        if (authState.required) {
            context = (req) => {
                const header = req.headers["authorization"] ?? ""
                const bearer = header.startsWith("Bearer ") ? header.slice(7) : null
                // 1) a ZEN session token (issued by /_auth/verify)
                if (bearer) {
                    const claims = verifyToken(bearer, authState.secret)
                    if (claims) return { user: claims.user, roles: claims.roles, policies: policiesFor(appPolicies, claims.roles), shares: [] }
                }
                // 2) a static API key (constant-time, SEC-06)
                const presented = bearer ?? req.headers["x-nexus-key"]
                let entry = null
                for (const k of keys) if (k.key && timingSafeStringEqual(k.key, presented ?? "")) entry = k
                if (entry) {
                    const roles = entry.roles ?? []
                    return { user: entry.user, roles, policies: policiesFor(appPolicies, roles), shares: [] }
                }
                throw new Error("E_AUTH: a valid session token or API key is required")
            }
        } else {
            const policies = [...devPolicies(schemas), ...appPolicies]
            context = (req) => ({ user: req.headers["x-nexus-user"] || "dev", roles: ["dev"], policies, shares: [] })
        }

        api = createApi({ plane, endpoints: extensions.endpoints, context })
        authMode = authState.required
            ? `${[keys.length && `${keys.length} API keys`, identities.length && `${identities.length} ZEN identities`].filter(Boolean).join(" + ")} (E_AUTH without credentials)`
            : "DEV identity — wide-open policies, user via x-nexus-user header"
    }

    return { api, authState, challenges, engine, authMode, extensions, embedderInfo }
}

export default { buildInstanceApi }
