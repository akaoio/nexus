/**
 * AI (embedding) models conformance (MODEL-*) — ARCHITECTURE.md §4.6b/§240.
 * Models are first-class: a curated registry, a config key (semantic.model),
 * the `nexus model` CLI, `nexus create --model`, and the Studio /_studio/ai
 * panel. The heavy `pull` (install + download) is exercised manually, not in
 * the suite; here we pin the registry, config, CLI, and endpoints.
 */

import { spawnSync, spawn } from "child_process"
import { mkdtempSync, rmSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import Test, { assert } from "../../src/kernel/Test.js"
import { MODELS, DEFAULT_MODEL, currentModel, withModel, status, progressLine } from "../../src/app/models.js"

const BIN = new URL("../../bin/nexus.js", import.meta.url).pathname

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
        rmSync(scratch, { recursive: true, force: true })
    })

    Test.it("MODEL-04 `nexus create --model` records the choice; `none` omits it", () => {
        const scratch = mkdtempSync(join(tmpdir(), "nexus-cm-"))
        const run = (args) => spawnSync(process.execPath, [BIN, "create", ...args, "--json"], { cwd: scratch, encoding: "utf8" })
        assert.equal(JSON.parse(run(["a", "--model", DEFAULT_MODEL]).stdout).model, DEFAULT_MODEL)
        assert.equal(JSON.parse(readFileSync(join(scratch, "a", "nexus.config.json"), "utf8")).semantic.model, DEFAULT_MODEL)
        run(["b", "--model", "none"])
        assert.equal(JSON.parse(readFileSync(join(scratch, "b", "nexus.config.json"), "utf8")).semantic, undefined)
        rmSync(scratch, { recursive: true, force: true })
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
        } finally {
            server.kill("SIGKILL")
            rmSync(scratch, { recursive: true, force: true })
        }
    })
})
