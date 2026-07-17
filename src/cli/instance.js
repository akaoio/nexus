/**
 * Instance loader — reads a Nexus instance directory (nexus.config.json +
 * apps/&#42;/models/&#42;.json) into validated schemas. Shared by the dev server
 * and any command that needs the instance's shape. Fails fast: a broken
 * schema is refused loudly, never served.
 */

import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { validate } from "../core/Model.js"
import * as Manifest from "../core/App/manifest.js"
import { loadPolicies } from "../core/App/policies.js"

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

/** The running core version (the §8.4.2 gate compares app engines to this). */
export const CORE_VERSION = JSON.parse(
    readFileSync(new URL("../../package.json", import.meta.url), "utf8")
).version

/**
 * Load an instance: config + per-app manifests (validated, engines-gated)
 * + entity schemas. Broken schemas, invalid manifests and out-of-range apps
 * are refused loudly — never served, never crashed-into later (§8.4.2).
 * @param {string} root - Instance directory (must contain nexus.config.json)
 * @returns {{config: Object, schemas: Array, apps: Array}}
 */
export function loadInstance(root) {
    const configPath = join(root, "nexus.config.json")
    if (!existsSync(configPath)) throw err("E_NO_INSTANCE", "no nexus.config.json here")
    const config = JSON.parse(readFileSync(configPath, "utf8"))

    const schemas = []
    const apps = []
    const appsDir = join(root, "apps")
    if (existsSync(appsDir))
        for (const app of readdirSync(appsDir)) {
            const manifestPath = join(appsDir, app, "manifest.json")
            if (existsSync(manifestPath)) {
                const manifest = JSON.parse(readFileSync(manifestPath, "utf8"))
                const result = Manifest.validate(manifest)
                if (!result.valid)
                    throw err("E_INVALID", `apps/${app}/manifest.json: ${JSON.stringify(result.errors)}`)
                if (!Manifest.compatible(manifest, CORE_VERSION))
                    throw err(
                        "E_ENGINE_RANGE",
                        `app "${manifest.name}" requires nexus ${manifest.engines.nexus} — this core is ${CORE_VERSION}`
                    )
                apps.push({ dir: app, manifest })
            }
            const modelsDir = join(appsDir, app, "models")
            if (!existsSync(modelsDir)) continue
            for (const entry of readdirSync(modelsDir)) {
                if (!entry.endsWith(".json")) continue
                const file = join("apps", app, "models", entry)
                const schema = JSON.parse(readFileSync(join(root, file), "utf8"))
                const result = validate(schema)
                if (!result.valid) throw err("E_INVALID", `${file}: ${JSON.stringify(result.errors)}`)
                if (schemas.some((s) => s.name === schema.name))
                    throw err("E_ENTITY_CONFLICT", `entity "${schema.name}" declared by more than one app`)
                schemas.push(schema)
            }
        }
    const policies = loadPolicies(root, apps, schemas)
    return { config, schemas, apps, policies }
}
