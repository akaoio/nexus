/**
 * Instance loader — reads a Nexus instance directory (nexus.config.json +
 * apps/&#42;/models/&#42;.json) into validated schemas. Shared by the dev server
 * and any command that needs the instance's shape. Fails fast: a broken
 * schema is refused loudly, never served.
 */

import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { validate } from "../model/Model.js"

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

/**
 * @param {string} root - Instance directory (must contain nexus.config.json)
 * @returns {{config: Object, schemas: Array}} Validated Entity schemas
 */
export function loadInstance(root) {
    const configPath = join(root, "nexus.config.json")
    if (!existsSync(configPath)) throw err("E_NO_INSTANCE", "no nexus.config.json here")
    const config = JSON.parse(readFileSync(configPath, "utf8"))

    const schemas = []
    const appsDir = join(root, "apps")
    if (existsSync(appsDir))
        for (const app of readdirSync(appsDir)) {
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
    return { config, schemas }
}
