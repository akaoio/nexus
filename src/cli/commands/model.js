/**
 * nexus model — AI (embedding) models as first-class citizens. List the curated
 * models, see status, switch the site's model, or pull one (install the library
 * + download the weights). The choice is written to semantic.model, which the
 * dev server reads to run semantic search/NL.
 *
 *   nexus model list
 *   nexus model status
 *   nexus model use onnx-community/embeddinggemma-300m-ONNX
 *   nexus model pull            # install @huggingface/transformers + download
 */

import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { MODELS, DEFAULT_MODEL, withModel, status, pull } from "../../app/models.js"

export async function model(args, flags, out) {
    const root = process.cwd()
    const configPath = join(root, "nexus.config.json")
    if (!existsSync(configPath)) {
        out.error("Not a Nexus instance (no nexus.config.json here)", { code: "E_NO_INSTANCE" })
        process.exitCode = 1
        return
    }
    const config = JSON.parse(readFileSync(configPath, "utf8"))
    const st = status(config, root)
    const sub = args[0] ?? "list"

    if (sub === "list") {
        for (const m of MODELS) {
            out.print(`  ${out.bold(m.name)}${m.id === st.model ? out.green("  ● in use") : ""}`)
            out.print(`     ${out.dim(m.id)}`)
            out.print(`     ${out.dim(`${m.dims}d · ${m.langs} · ${m.size} · ${m.note}`)}`)
        }
        out.print("")
        out.print(`  library: ${st.libInstalled ? out.green("@huggingface/transformers installed") : out.yellow("not installed — run `nexus model pull`")}`)
        out.emit({ ok: true, models: MODELS, current: st.model, libInstalled: st.libInstalled })
        return
    }
    if (sub === "status") {
        out.print(`  model    ${st.model ? out.cyan(st.model) : out.dim("none — keyword (lexical) search")}`)
        out.print(`  library  ${st.libInstalled ? out.green("installed") : out.yellow("not installed")}`)
        out.print(`  mode     ${st.mode}`)
        out.emit({ ok: true, ...st })
        return
    }
    if (sub === "use") {
        const id = args[1]
        if (!id) {
            out.error("nexus model use <id> (or `none`)", { code: "E_USAGE" })
            process.exitCode = 2
            return
        }
        writeFileSync(configPath, JSON.stringify(withModel(config, id === "none" ? null : id), null, 4) + "\n")
        out.print(`${out.green("✓")} model set to ${id === "none" ? out.dim("none (lexical)") : out.cyan(id)}`)
        if (id !== "none" && !st.libInstalled) out.hint("run `nexus model pull` to install the library and download the weights")
        out.emit({ ok: true, model: id === "none" ? null : id })
        return
    }
    if (sub === "pull") {
        const id = args[1] || st.model || DEFAULT_MODEL
        out.print(`${out.dim("↓")} installing @huggingface/transformers + downloading ${out.cyan(id)} — this can take a while…`)
        try {
            const result = await pull(root, id)
            if (!st.model) writeFileSync(configPath, JSON.stringify(withModel(config, id), null, 4) + "\n")
            out.print(`${out.green("✓")} ready — ${id} (${result.dims}d)`)
            out.emit({ ok: true, ...result })
        } catch (error) {
            out.error(error.message, { code: error.message.split(":")[0] })
            process.exitCode = 1
        }
        return
    }
    out.error(`Unknown: nexus model ${sub} (use list|status|use|pull)`, { code: "E_USAGE" })
    process.exitCode = 2
}

export default model
