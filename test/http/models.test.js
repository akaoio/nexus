/**
 * AI (embedding) models conformance (MODEL-*) — ARCHITECTURE.md §4.6b/§240.
 * Models are first-class: a curated registry, a config key (semantic.model),
 * the `nexus model` CLI, `nexus create --model`, and the Studio /_studio/ai
 * panel. The heavy `pull` (install + download) is exercised manually, not in
 * the suite; here we pin the registry, config, CLI, and endpoints.
 */

import { fileURLToPath } from "url"
import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/core/Test.js"
import { MODELS, DEFAULT_MODEL, NL_MODELS, DEFAULT_NL_MODEL, kindOf, currentModel, currentNlModel, withModel, withNlModel, status, progressLine } from "../../src/core/App/models.js"

const BIN = fileURLToPath(new URL("../../bin/nexus.js", import.meta.url))

Test.describe("AI models (MODEL)", () => {
    Test.it("MODEL-01 registry + pure config ops", () => {
        assert.truthy(MODELS.length >= 3, "a curated registry")
        assert.equal(MODELS[0].id, DEFAULT_MODEL)
        assert.truthy(MODELS.every((m) => m.id && m.name && m.dims && m.langs && m.size))
        const c1 = withModel({ site: {} }, "onnx-community/embeddinggemma-300m-ONNX")
        assert.equal(currentModel(c1), "onnx-community/embeddinggemma-300m-ONNX")
        const c2 = withModel(c1, null) // clearing removes the key
        assert.equal(currentModel(c2), null)
        assert.equal("model" in (c2.semantic ?? {}), false)
    })

    Test.it("MODEL-02 status reports mode from config + library presence", () => {
        const st = status({ semantic: { model: DEFAULT_MODEL } }, "/nonexistent-instance-dir")
        assert.equal(st.model, DEFAULT_MODEL)
        assert.equal(st.libInstalled, false) // no transformers under that dir
        assert.equal(st.mode, "configured-not-installed")
        assert.equal(status({}, "/nope").mode, "lexical") // no model → lexical
    })

    Test.it("MODEL-07 two-slot registry: kindOf + pure NL config ops + status", () => {
        assert.truthy(NL_MODELS.length >= 1, "a curated NL registry")
        assert.equal(NL_MODELS[0].id, DEFAULT_NL_MODEL)
        for (const m of MODELS) assert.equal(kindOf(m.id), "embedding")
        for (const m of NL_MODELS) assert.equal(kindOf(m.id), "nl")
        assert.equal(kindOf("nobody/unknown-model"), null)
        const c1 = withNlModel({ site: {} }, DEFAULT_NL_MODEL)
        assert.equal(currentNlModel(c1), DEFAULT_NL_MODEL)
        assert.equal(currentModel(c1), null) // slots are independent
        const c2 = withNlModel(c1, null) // clearing removes the key
        assert.equal(currentNlModel(c2), null)
        assert.equal("nlModel" in (c2.semantic ?? {}), false)
        const st = status({ semantic: { nlModel: DEFAULT_NL_MODEL } }, "/nope")
        assert.equal(st.nlModel, DEFAULT_NL_MODEL)
        assert.equal(st.nlKnown.name, "FunctionGemma 270M")
        assert.equal(st.model, null)
    })

    Test.it("MODEL-03 `nexus model use/list/status` reads and writes the config", () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-model-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const cwd = join(scratch, "shop")
        const run = (args) => spawnSync(process.execPath, [BIN, "model", ...args, "--json"], { cwd, encoding: "utf8" })
        assert.equal(JSON.parse(run(["use", DEFAULT_MODEL]).stdout).model, DEFAULT_MODEL)
        assert.equal(JSON.parse(readFileSync(join(cwd, "nexus.config.json"), "utf8")).semantic.model, DEFAULT_MODEL)
        assert.equal(JSON.parse(run(["list"]).stdout).current, DEFAULT_MODEL)
        assert.equal(JSON.parse(run(["status"]).stdout).model, DEFAULT_MODEL)
        // `use none` clears it
        run(["use", "none"])
        assert.equal(JSON.parse(readFileSync(join(cwd, "nexus.config.json"), "utf8")).semantic?.model ?? null, null)
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("MODEL-04 `nexus create --model` records the choice; `none` omits it", () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-cm-"))
        const run = (args) => spawnSync(process.execPath, [BIN, "create", ...args, "--json"], { cwd: scratch, encoding: "utf8" })
        assert.equal(JSON.parse(run(["a", "--model", DEFAULT_MODEL]).stdout).model, DEFAULT_MODEL)
        assert.equal(JSON.parse(readFileSync(join(scratch, "a", "nexus.config.json"), "utf8")).semantic.model, DEFAULT_MODEL)
        run(["b", "--model", "none"])
        assert.equal(JSON.parse(readFileSync(join(scratch, "b", "nexus.config.json"), "utf8")).semantic, undefined)
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("MODEL-08 `nexus create --nl-model` records the NL choice; omitted/none stays absent", () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-cnl-"))
        const run = (args) => spawnSync(process.execPath, [BIN, "create", ...args, "--json"], { cwd: scratch, encoding: "utf8" })
        assert.equal(JSON.parse(run(["a", "--nl-model", DEFAULT_NL_MODEL]).stdout).nlModel, DEFAULT_NL_MODEL)
        const cfg = JSON.parse(readFileSync(join(scratch, "a", "nexus.config.json"), "utf8"))
        assert.equal(cfg.semantic.nlModel, DEFAULT_NL_MODEL)
        assert.equal(cfg.semantic.model, undefined) // slots independent
        run(["b"]) // no flag, non-interactive → nothing written
        assert.equal(JSON.parse(readFileSync(join(scratch, "b", "nexus.config.json"), "utf8")).semantic, undefined)
        run(["c", "--nl-model", "none"])
        assert.equal(JSON.parse(readFileSync(join(scratch, "c", "nexus.config.json"), "utf8")).semantic, undefined)
        // a trailing value-less flag parses as boolean true — it must not leak into the config
        run(["d", "--model"])
        assert.equal(JSON.parse(readFileSync(join(scratch, "d", "nexus.config.json"), "utf8")).semantic, undefined)
        run(["e", "--nl-model"])
        assert.equal(JSON.parse(readFileSync(join(scratch, "e", "nexus.config.json"), "utf8")).semantic, undefined)
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("MODEL-09 `nexus model` routes NL ids to semantic.nlModel; `none --nl` clears only that slot", () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-mnl-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const cwd = join(scratch, "shop")
        const run = (args) => spawnSync(process.execPath, [BIN, "model", ...args, "--json"], { cwd, encoding: "utf8" })
        run(["use", DEFAULT_MODEL])
        assert.equal(JSON.parse(run(["use", DEFAULT_NL_MODEL]).stdout).nlModel, DEFAULT_NL_MODEL)
        let cfg = JSON.parse(readFileSync(join(cwd, "nexus.config.json"), "utf8"))
        assert.equal(cfg.semantic.nlModel, DEFAULT_NL_MODEL)
        assert.equal(cfg.semantic.model, DEFAULT_MODEL) // embedding slot untouched
        const listed = JSON.parse(run(["list"]).stdout)
        assert.truthy(listed.nlModels.length >= 1)
        assert.equal(listed.currentNl, DEFAULT_NL_MODEL)
        assert.equal(JSON.parse(run(["status"]).stdout).nlModel, DEFAULT_NL_MODEL)
        run(["use", "none", "--nl"]) // clears ONLY the NL slot
        cfg = JSON.parse(readFileSync(join(cwd, "nexus.config.json"), "utf8"))
        assert.equal(cfg.semantic?.nlModel, undefined)
        assert.equal(cfg.semantic.model, DEFAULT_MODEL)
        // ids unknown to both registries stay in the embedding slot (back-compat)…
        assert.equal(JSON.parse(run(["use", "acme/custom-model"]).stdout).model, "acme/custom-model")
        cfg = JSON.parse(readFileSync(join(cwd, "nexus.config.json"), "utf8"))
        assert.equal(cfg.semantic.model, "acme/custom-model")
        assert.equal(cfg.semantic?.nlModel, undefined)
        // …with a human-mode warning (spec: unknown ids warn but write)
        const human = spawnSync(process.execPath, [BIN, "model", "use", "acme/custom-model"], { cwd, encoding: "utf8" })
        assert.equal(human.stderr.includes("unknown"), true)
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })

    Test.it("MODEL-06 progressLine formats a download event into % + MB, skips non-progress", () => {
        assert.equal(progressLine({ status: "progress", file: "model.onnx", loaded: 52428800, total: 209715200 }).includes("25%"), true)
        assert.equal(progressLine({ status: "progress", file: "m", loaded: 52428800, total: 209715200 }).includes("50.0/200.0 MB"), true)
        assert.equal(progressLine({ status: "done" }), null)
        assert.equal(progressLine({ status: "progress", total: 0 }), null)
    })

    Test.it("MODEL-05 /_studio/ai reports status + models and switches the model", async () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-aie-"))
        spawnSync(process.execPath, [BIN, "create", "shop"], { cwd: scratch })
        const server = spawn(process.execPath, [BIN, "dev", "--port", "0", "--json"], { cwd: join(scratch, "shop") })
        try {
            const base = await new Promise((resolve, reject) => {
                const timer = setTimeout(() => reject(new Error("dev did not start")), 6000)
                let buf = ""
                server.stdout.on("data", (c) => { buf += c; try { clearTimeout(timer); resolve(JSON.parse(buf).url) } catch {} })
                server.on("exit", () => reject(new Error("dev exited early")))
            })
            const ai = await (await fetch(base + "/_studio/ai")).json()
            assert.truthy(ai.data.models.length >= 3)
            assert.equal(ai.data.mode, "lexical") // fresh instance, no model
            const set = await (await fetch(base + "/_studio/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model: DEFAULT_MODEL }) })).json()
            assert.equal(set.data.model, DEFAULT_MODEL)
            assert.equal(JSON.parse(readFileSync(join(scratch, "shop", "nexus.config.json"), "utf8")).semantic.model, DEFAULT_MODEL)
            assert.truthy(ai.data.nlModels.length >= 1) // the NL registry is exposed
            const setNl = await (await fetch(base + "/_studio/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nlModel: DEFAULT_NL_MODEL }) })).json()
            assert.equal(setNl.data.nlModel, DEFAULT_NL_MODEL)
            const cfg = JSON.parse(readFileSync(join(scratch, "shop", "nexus.config.json"), "utf8"))
            assert.equal(cfg.semantic.nlModel, DEFAULT_NL_MODEL)
            assert.equal(cfg.semantic.model, DEFAULT_MODEL) // a { nlModel } POST must NOT clear the embedding slot
        } finally {
            await new Promise((resolve) => { server.once("exit", resolve); server.kill("SIGKILL") })
            rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    })
})
