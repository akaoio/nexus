/**
 * nexus model — AI (embedding) models as first-class citizens. List the curated
 * models (both slots), see status, switch the site's model, or pull one (install
 * the library + download the weights). `use <id>` infers the slot from the id
 * (`--nl` forces the NL slot; needed for `none` and ids unknown to the registry).
 * `pull` with no id warms every configured model.
 *
 *   nexus model list
 *   nexus model status
 *   nexus model use onnx-community/embeddinggemma-300m-ONNX
 *   nexus model use onnx-community/functiongemma-270m-it-ONNX
 *   nexus model use none --nl   # clear NL slot only
 *   nexus model pull            # install @huggingface/transformers + download
 */

import { existsSync, readFileSync, writeFileSync } from "fs"
import { join } from "path"
import { MODELS, DEFAULT_MODEL, NL_MODELS, kindOf, withModel, withNlModel, status, pull, progressLine } from "../../core/App/models.js"

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
        out.print(`  ${out.bold("Embedding")}`)
        for (const m of MODELS) {
            out.print(`  ${out.bold(m.name)}${m.id === st.model ? out.green("  ● in use") : ""}`)
            out.print(`     ${out.dim(m.id)}`)
            out.print(`     ${out.dim(`${m.dims}d · ${m.langs} · ${m.size} · ${m.note}`)}`)
        }
        out.print(`  ${out.bold("NL (function calling)")}`)
        for (const m of NL_MODELS) {
            out.print(`  ${out.bold(m.name)}${m.id === st.nlModel ? out.green("  ● in use") : ""}`)
            out.print(`     ${out.dim(m.id)}`)
            out.print(`     ${out.dim(`${m.langs} · ${m.size} · ${m.note}`)}`)
        }
        out.print("")
        out.print(`  library: ${st.libInstalled ? out.green("@huggingface/transformers installed") : out.yellow("not installed — run `nexus model pull`")}`)
        out.emit({ ok: true, models: MODELS, nlModels: NL_MODELS, current: st.model, currentNl: st.nlModel, libInstalled: st.libInstalled })
        return
    }
    if (sub === "status") {
        out.print(`  model    ${st.model ? out.cyan(st.model) : out.dim("none — keyword (lexical) search")}`)
        out.print(`  nl model ${st.nlModel ? out.cyan(st.nlModel) : out.dim("none — rule/retrieval tiers only")}`)
        out.print(`  library  ${st.libInstalled ? out.green("installed") : out.yellow("not installed")}`)
        out.print(`  mode     ${st.mode}`)
        out.emit({ ok: true, ...st })
        return
    }
    if (sub === "use") {
        const id = args[1]
        if (!id) {
            out.error("nexus model use <id> (or `none`; `--nl` targets the NL slot)", { code: "E_USAGE" })
            process.exitCode = 2
            return
        }
        const clear = id === "none"
        // the slot: --nl forces it; otherwise the registry decides; unknown ids
        // stay in the embedding slot (today's behavior)
        const nl = flags.nl === true || (!clear && kindOf(id) === "nl")
        const next = (nl ? withNlModel : withModel)(config, clear ? null : id)
        writeFileSync(configPath, JSON.stringify(next, null, 4) + "\n")
        if (!clear && !kindOf(id)) out.hint(`unknown model id (not in the curated registry) — written to the ${nl ? "NL" : "embedding"} slot anyway`)
        const label = nl ? "NL model" : "model"
        out.print(`${out.green("✓")} ${label} set to ${clear ? out.dim(nl ? "none (rule/retrieval tiers)" : "none (lexical)") : out.cyan(id)}`)
        if (!clear && !st.libInstalled) out.hint("run `nexus model pull` to install the library and download the weights")
        out.emit(nl ? { ok: true, nlModel: clear ? null : id } : { ok: true, model: clear ? null : id })
        return
    }
    if (sub === "pull") {
        // explicit id → that model; otherwise every configured slot; nothing
        // configured → the embedding default (today's behavior)
        const ids = args[1] ? [args[1]] : [st.model, st.nlModel].filter(Boolean)
        if (!ids.length) ids.push(DEFAULT_MODEL)
        const results = []
        for (const id of ids) {
            out.print(`${out.dim("↓")} installing @huggingface/transformers + downloading ${out.cyan(id)}…`)
            const seen = new Set()
            const onProgress = (event) => {
                const line = progressLine(event)
                // one line per file, overwriting as it advances (TTY); plain when piped
                if (line && !flags.json) { if (process.stdout.isTTY) process.stdout.write("\r  " + line.padEnd(60)); else if (!seen.has(event.file + Math.round((event.loaded / event.total) * 10))) { seen.add(event.file + Math.round((event.loaded / event.total) * 10)); process.stdout.write("  " + line + "\n") } }
            }
            try {
                const result = await pull(root, id, onProgress)
                if (process.stdout.isTTY && !flags.json) process.stdout.write("\r" + " ".repeat(66) + "\r")
                // a pulled model fills its own EMPTY slot (generalizes the old embedding rule)
                const cfgNow = JSON.parse(readFileSync(configPath, "utf8"))
                const nl = kindOf(id) === "nl"
                if (nl ? !cfgNow.semantic?.nlModel : !cfgNow.semantic?.model)
                    writeFileSync(configPath, JSON.stringify((nl ? withNlModel : withModel)(cfgNow, id), null, 4) + "\n")
                out.print(`${out.green("✓")} ready — ${id}${result.dims ? ` (${result.dims}d)` : ""}`)
                results.push(result)
            } catch (error) {
                out.error(error.message, { code: error.message.split(":")[0] })
                process.exitCode = 1
                return
            }
        }
        out.emit(results.length === 1 ? { ok: true, ...results[0] } : { ok: true, pulled: results })
        return
    }
    out.error(`Unknown: nexus model ${sub} (use list|status|use|pull)`, { code: "E_USAGE" })
    process.exitCode = 2
}

export default model
