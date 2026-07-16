/**
 * nexus test [filter] — validate the instance's schemas.
 *
 * A thin shell over the public Model API (§5.2 rule 1): every model file
 * under apps/&#42;/models/ runs through Model.validate; manifests must parse.
 * Exit 1 when anything is invalid — this command is CI-ready by design.
 */

import { existsSync, readdirSync, readFileSync } from "fs"
import { join } from "path"
import { validate } from "../../model/Model.js"
import * as Manifest from "../../app/Manifest.js"

function listInstanceFiles(root) {
    const files = []
    const appsDir = join(root, "apps")
    if (!existsSync(appsDir)) return files
    for (const app of readdirSync(appsDir)) {
        const manifest = join(appsDir, app, "manifest.json")
        if (existsSync(manifest)) files.push({ file: join("apps", app, "manifest.json"), kind: "manifest" })
        const modelsDir = join(appsDir, app, "models")
        if (!existsSync(modelsDir)) continue
        for (const entry of readdirSync(modelsDir))
            if (entry.endsWith(".json")) files.push({ file: join("apps", app, "models", entry), kind: "model" })
    }
    return files
}

export async function test(args, flags, out) {
    const root = process.cwd()
    if (!existsSync(join(root, "nexus.config.json"))) {
        out.error("Not a Nexus instance (no nexus.config.json here)", { code: "E_NO_INSTANCE" })
        process.exitCode = 1
        return
    }

    const filter = args[0]
    const candidates = listInstanceFiles(root).filter((f) => !filter || f.file.includes(filter))
    const results = []

    for (const { file, kind } of candidates) {
        try {
            const content = JSON.parse(readFileSync(join(root, file), "utf8"))
            if (kind === "model") {
                const result = validate(content)
                results.push(result.valid ? { file, valid: true } : { file, valid: false, errors: result.errors })
            } else {
                const result = Manifest.validate(content)
                results.push(result.valid ? { file, valid: true } : { file, valid: false, errors: result.errors })
            }
        } catch (error) {
            results.push({ file, valid: false, errors: [{ code: "E_PARSE", path: "", message: error.message }] })
        }
    }

    const invalid = results.filter((r) => !r.valid)
    for (const r of results) {
        if (r.valid) out.print(`  ${out.green("✓")} ${r.file}`)
        else {
            out.print(`  ${out.red("✗")} ${r.file}`)
            for (const e of r.errors) out.print(`      ${out.red(e.code)} ${out.dim(e.path || "")}`)
        }
    }
    out.print("")
    if (invalid.length === 0) out.print(out.green(`  All ${results.length} schema files valid`))
    else out.print(out.red(`  ${invalid.length} of ${results.length} schema files invalid`))

    out.emit({
        ok: invalid.length === 0,
        checked: results.length,
        valid: results.length - invalid.length,
        invalid: invalid.length,
        files: results
    })
    if (invalid.length > 0) process.exitCode = 1
}
