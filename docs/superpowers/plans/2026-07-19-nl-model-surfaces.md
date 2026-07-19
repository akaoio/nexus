# NL Model Surfaces Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the NL (function-calling) model first-class — configurable from `nexus create`, `nexus model`, `/_studio/ai`, and the Studio `/settings/ai` page — driven by a two-slot registry in `App/models.js`.

**Architecture:** `src/core/App/models.js` becomes the single two-slot registry (embedding + NL): `kindOf(id)` classifies ids, `currentNlModel`/`withNlModel` mirror the embedding pair over `semantic.nlModel`, `status()` reports both slots, `pull()` dispatches on kind (NL warms via `functionGemmaGenerator`). All four surfaces only call these helpers.

**Tech Stack:** Node ESM, zero runtime deps (kernel), repo's own conformance harness (`src/core/Test.js`, run via `npm test`), real-process CLI clauses (`spawnSync` on `bin/nexus.js`).

**Spec:** `docs/superpowers/specs/2026-07-19-nl-model-surfaces-design.md`

## Global Constraints

- Spec-first TDD (N6): every behavior lands as a RED conformance clause first; clause ids continue the `MODEL-*` series in `test/http/models.test.js`.
- The kernel never gains a dependency (N2); `@huggingface/transformers` stays the INSTANCE's library.
- No heavy downloads in the suite — `pull` behavior is pinned only through pure/config paths.
- Config keys: embedding = `semantic.model`, NL = `semantic.nlModel`; absent key = slot off; `withModel`/`withNlModel` stay pure and delete the key when passed null.
- Non-interactive `nexus create` (no TTY / `--yes` / `--json` / piped) writes NO NL key unless `--nl-model` is given.
- Commit style: repo's sentence style (e.g. `Models: …`), each commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.
- Run a task's clause with `npm test` (full suite is fast); expected totals: every existing clause stays green, 0 red.

---

### Task 1: Two-slot registry in `App/models.js`

**Files:**
- Modify: `src/core/App/models.js`
- Modify: `src/core/NL/llm.js:21` (dedupe `DEFAULT_NL_MODEL`)
- Test: `test/http/models.test.js`

**Interfaces:**
- Produces (later tasks consume exactly these):
  - `DEFAULT_NL_MODEL: string` (= `NL_MODELS[0].id`)
  - `kindOf(id: string) → "embedding" | "nl" | null`
  - `currentNlModel(config) → string | null`
  - `withNlModel(config, id: string | null) → config` (pure; null deletes `semantic.nlModel`)
  - `status(config, root)` gains `nlModel: string | null`, `nlKnown: registryEntry | null`
  - `pull(root, id, onProgress)` accepts NL ids → returns `{ model: id }` (no `dims`)

- [ ] **Step 1: Write the failing clause MODEL-07**

In `test/http/models.test.js`, extend the import at line 15:

```js
import { MODELS, DEFAULT_MODEL, NL_MODELS, DEFAULT_NL_MODEL, kindOf, currentModel, currentNlModel, withModel, withNlModel, status, progressLine } from "../../src/core/App/models.js"
```

Add inside `Test.describe`, after MODEL-02:

```js
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
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: MODEL-07 RED (import of `kindOf`/`withNlModel` fails or asserts throw); everything else green.

- [ ] **Step 3: Implement the registry additions**

In `src/core/App/models.js`, directly under the `NL_MODELS` block (after line 24), add:

```js
export const DEFAULT_NL_MODEL = NL_MODELS[0].id

/** Which slot an id belongs to: "embedding" | "nl" | null (unknown). */
export function kindOf(id = "") {
    if (MODELS.some((m) => m.id === id)) return "embedding"
    if (NL_MODELS.some((m) => m.id === id)) return "nl"
    return null
}
```

Under `withModel` add the NL mirror pair:

```js
/** The NL (function-calling) model configured for a site, or null. */
export function currentNlModel(config) {
    return config?.semantic?.nlModel ?? null
}

/** Return a config with `semantic.nlModel` set to `id` (pure). */
export function withNlModel(config, id) {
    const next = { ...config, semantic: { ...(config?.semantic ?? {}), nlModel: id } }
    if (!id) delete next.semantic.nlModel
    return next
}
```

Replace the body of `status` with:

```js
export function status(config, root) {
    const id = currentModel(config)
    const nl = currentNlModel(config)
    return {
        model: id,
        known: id ? MODELS.find((m) => m.id === id) ?? null : null,
        nlModel: nl,
        nlKnown: nl ? NL_MODELS.find((m) => m.id === nl) ?? null : null,
        libInstalled: libInstalled(root),
        mode: id ? (libInstalled(root) ? "semantic" : "configured-not-installed") : "lexical"
    }
}
```

Replace `pull` with the kind-dispatching version (NL warm = one tiny generate so the weights fully materialize; `filterTool` with an empty-fields schema keeps the dialect exact):

```js
export async function pull(root, id = DEFAULT_MODEL, onProgress) {
    if (!libInstalled(root)) installLib(root)
    if (kindOf(id) === "nl") {
        const { functionGemmaGenerator, filterTool } = await import("../NL/llm.js")
        const generate = await functionGemmaGenerator({ model: id, root, onProgress })
        await generate({ tools: [filterTool({ name: "warmup", fields: [] })], user: "warm up" })
        return { model: id }
    }
    const { transformersProvider } = await import("../Semantic/transformers.js")
    const embedder = await transformersProvider({ model: id, root, onProgress })
    // one embed forces the model to fully materialize
    await embedder.embed(["warm up"])
    return { model: id, dims: embedder.dims }
}
```

Update the module's default export line to:

```js
export default { MODELS, DEFAULT_MODEL, NL_MODELS, DEFAULT_NL_MODEL, kindOf, currentModel, currentNlModel, withModel, withNlModel, libInstalled, status, installLib, pull }
```

Also update the file's top docstring: it currently says "AI (embedding) models"; amend to say it is the two-slot registry (embedding `semantic.model` + NL `semantic.nlModel`).

In `src/core/NL/llm.js`, delete line 21 (`export const DEFAULT_NL_MODEL = "onnx-community/functiongemma-270m-it-ONNX"`) and add at the top of the imports (single source; no cycle — models.js only imports llm.js dynamically inside `pull`; a plain `export {} from` re-export would NOT bind the name locally for `functionGemmaGenerator`'s default parameter, so import-then-export):

```js
import { DEFAULT_NL_MODEL } from "../App/models.js"
export { DEFAULT_NL_MODEL }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: MODEL-07 green; all NL-*/FG-* clauses still green (llm.js dedupe must not break them); 0 red.

- [ ] **Step 5: Commit**

```bash
git add src/core/App/models.js src/core/NL/llm.js test/http/models.test.js
git commit -m "Models: two-slot registry — kindOf + nlModel config ops, pull dispatches on kind (MODEL-07)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `nexus create` asks for the NL model

**Files:**
- Modify: `src/cli/main.js:27` (VALUE_FLAGS)
- Modify: `src/cli/commands/create.js`
- Test: `test/http/models.test.js`

**Interfaces:**
- Consumes: `NL_MODELS`, `pull` from `App/models.js` (Task 1).
- Produces: `nexus create --nl-model <id|none>`; interactive question defaults to FunctionGemma; `out.emit` gains `nlModel`.

- [ ] **Step 1: Write the failing clause MODEL-08**

Add to `test/http/models.test.js` after MODEL-04:

```js
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
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: MODEL-08 RED — `--nl-model` swallows no value (not in VALUE_FLAGS) and `semantic.nlModel` is never written. Others green.

- [ ] **Step 3: Implement**

`src/cli/main.js:27` — add the flag:

```js
const VALUE_FLAGS = new Set(["port", "site", "engine", "name", "role", "roles", "model", "nl-model"])
```

`src/cli/commands/create.js`:

1. Extend the models import (line 15):

```js
import { MODELS, NL_MODELS, pull } from "../../core/App/models.js"
```

2. After the embedding-model block (line 97), add the NL question — wizard default IS FunctionGemma (design decision):

```js
    // NL (function calling) model — tier 4 of NL→AST. --nl-model sets it;
    // the wizard defaults to FunctionGemma; without a TTY nothing is written
    // (CI never surprise-downloads ~300 MB of weights).
    let nlModel = null
    if (flags["nl-model"] !== undefined) nlModel = flags["nl-model"] && flags["nl-model"] !== "none" ? flags["nl-model"] : null
    else if (interactive) {
        const opts = [...NL_MODELS.map((m) => `${m.name} — ${m.note} (${m.size})`), "none — rule/retrieval tiers only"]
        const picked = await choose("NL (function calling) model", opts, opts[0])
        const idx = opts.indexOf(picked)
        nlModel = idx >= 0 && idx < NL_MODELS.length ? NL_MODELS[idx].id : null
    }
```

3. In the `files` map, replace the `nexus.config.json` value:

```js
        "nexus.config.json": {
            configVersion: 1,
            site: { name: site, locale: "en" },
            database: { engine },
            ...(aiModel || nlModel
                ? { semantic: { ...(aiModel ? { model: aiModel } : {}), ...(nlModel ? { nlModel } : {}) } }
                : {})
        },
```

4. Summary line (line 165) — append the NL model:

```js
    out.print(`${out.green("✓")} Created Nexus instance ${out.bold(site)} in ${out.cyan(dir)} ${out.dim(`· ${engine}${aiModel ? " · " + aiModel : ""}${nlModel ? " · " + nlModel : ""}`)}`)
```

5. Replace the download offer block (lines 170–182) so it covers both models:

```js
    // AI models: in a terminal, offer to install + download them right now.
    const downloads = [aiModel, nlModel].filter(Boolean)
    if (downloads.length && interactive) {
        const yes = await ask(`Download ${downloads.join(" + ")} now? installs @huggingface/transformers + weights [y/N]`, "N")
        if (/^y/i.test(yes)) {
            for (const id of downloads) {
                out.print(`${out.dim("↓")} pulling ${id} — this can take a while…`)
                try {
                    const pulled = await pull(target, id)
                    out.print(`${out.green("✓")} model ready${pulled.dims ? ` (${pulled.dims}d)` : ""}`)
                } catch (error) {
                    out.print(`${out.yellow("!")} pull failed: ${error.message} — run \`nexus model pull\` later`)
                }
            }
        }
    }
```

6. Next-steps hint (line 187) — condition on either slot:

```js
    if (aiModel || nlModel) out.print(`  nexus model pull   ${out.dim(`install + download ${[aiModel, nlModel].filter(Boolean).join(" + ")}`)}`)
```

7. Final emit (line 190):

```js
    out.emit({ ok: true, site, dir, engine, model: aiModel, nlModel, created })
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: MODEL-08 green; MODEL-03/04 (which scaffold via `create` non-interactively) unchanged and green; 0 red.

- [ ] **Step 5: Commit**

```bash
git add src/cli/main.js src/cli/commands/create.js test/http/models.test.js
git commit -m "create: ask for the NL model — wizard defaults to FunctionGemma, --nl-model for CI (MODEL-08)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `nexus model` learns the NL slot

**Files:**
- Modify: `src/cli/commands/model.js`
- Test: `test/http/models.test.js`

**Interfaces:**
- Consumes: `NL_MODELS`, `kindOf`, `withNlModel`, extended `status`/`pull` (Task 1).
- Produces: `model list` shows two groups (`--json`: `nlModels`, `currentNl`); `model use <id>` routes by `kindOf` (`--nl` forces the NL slot, `use none --nl` clears it); `model pull` (no id) warms every configured slot.

- [ ] **Step 1: Write the failing clause MODEL-09**

Add to `test/http/models.test.js` after MODEL-08:

```js
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
        rmSync(scratch, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: MODEL-09 RED — `use <nl-id>` currently writes `semantic.model`. Others green.

- [ ] **Step 3: Implement**

`src/cli/commands/model.js` — extend the import (line 15):

```js
import { MODELS, DEFAULT_MODEL, NL_MODELS, kindOf, withModel, withNlModel, status, pull, progressLine } from "../../core/App/models.js"
```

Update the top docstring: `nexus model` covers BOTH slots — `use <id>` infers the slot from the id (`--nl` forces the NL slot; needed for `none` and ids unknown to the registry), `pull` with no id warms every configured model.

Replace the `list` branch:

```js
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
```

In the `status` branch, add an `nl` line before `library` (the JSON already carries `nlModel` via `...st`):

```js
        out.print(`  nl model ${st.nlModel ? out.cyan(st.nlModel) : out.dim("none — rule/retrieval tiers only")}`)
```

Replace the `use` branch:

```js
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
        const label = nl ? "NL model" : "model"
        out.print(`${out.green("✓")} ${label} set to ${clear ? out.dim(nl ? "none (rule/retrieval tiers)" : "none (lexical)") : out.cyan(id)}`)
        if (!clear && !st.libInstalled) out.hint("run `nexus model pull` to install the library and download the weights")
        out.emit(nl ? { ok: true, nlModel: clear ? null : id } : { ok: true, model: clear ? null : id })
        return
    }
```

Replace the `pull` branch (multi-slot; the per-file progress helper is unchanged):

```js
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
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: MODEL-09 green; MODEL-03 (embedding `use`/`list`/`status` back-compat) still green; 0 red.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/model.js test/http/models.test.js
git commit -m "model CLI: two slots — use/pull infer the slot from the id, list shows both groups (MODEL-09)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: `/_studio/ai` carries the NL slot

**Files:**
- Modify: `src/cli/commands/dev.js:23` (import) and the `/_studio/ai` handlers (~lines 328–337)
- Test: `test/http/models.test.js` (extend MODEL-05 — reuses its running dev server)

**Interfaces:**
- Consumes: `NL_MODELS`, `withNlModel`, `currentModel`, `currentNlModel`, extended `modelStatus` (Task 1).
- Produces: GET `/_studio/ai` → `{ …status, models, nlModels }`; POST accepts `{ model }` and/or `{ nlModel }`, each key applied independently; response `{ model, nlModel, restart: true }`.

- [ ] **Step 1: Extend clause MODEL-05 (RED)**

In MODEL-05, after the existing POST assertion block (the `set` fetch + config assert), add:

```js
            assert.truthy(ai.data.nlModels.length >= 1) // the NL registry is exposed
            const setNl = await (await fetch(base + "/_studio/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nlModel: DEFAULT_NL_MODEL }) })).json()
            assert.equal(setNl.data.nlModel, DEFAULT_NL_MODEL)
            const cfg = JSON.parse(readFileSync(join(scratch, "shop", "nexus.config.json"), "utf8"))
            assert.equal(cfg.semantic.nlModel, DEFAULT_NL_MODEL)
            assert.equal(cfg.semantic.model, DEFAULT_MODEL) // a { nlModel } POST must NOT clear the embedding slot
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test`
Expected: MODEL-05 RED — `nlModels` missing from GET, and today's POST (`withModel(cfg, body?.model || null)`) would clear `semantic.model` on an `{ nlModel }`-only body. Others green.

- [ ] **Step 3: Implement**

`src/cli/commands/dev.js:23` — extend the import:

```js
import { MODELS, NL_MODELS, status as modelStatus, withModel, withNlModel, currentModel, currentNlModel } from "../../core/App/models.js"
```

Replace the two handlers (~lines 328–337):

```js
        if (url.pathname === "/_studio/ai" && req.method === "GET") {
            const cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
            return json(res, 200, { ok: true, data: { ...modelStatus(cfg, root), models: MODELS, nlModels: NL_MODELS } })
        }
        if (url.pathname === "/_studio/ai" && req.method === "POST") {
            const body = await readJson(req)
            let cfg = JSON.parse(readFileSync(join(root, "nexus.config.json"), "utf8"))
            // each slot is applied only when its key is present — independent slots
            if (body && "model" in body) cfg = withModel(cfg, body.model || null)
            if (body && "nlModel" in body) cfg = withNlModel(cfg, body.nlModel || null)
            writeFileSync(join(root, "nexus.config.json"), JSON.stringify(cfg, null, 4) + "\n")
            return json(res, 200, { ok: true, data: { model: currentModel(cfg), nlModel: currentNlModel(cfg), restart: true } })
        }
```

- [ ] **Step 4: Run to verify it passes**

Run: `npm test`
Expected: MODEL-05 green (old asserts + new); 0 red.

- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/dev.js test/http/models.test.js
git commit -m "dev: /_studio/ai carries both slots — nlModels in GET, independent { nlModel } POST (MODEL-05)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Studio `/settings/ai` gets the NL section

**Files:**
- Modify: `src/studio/routes/settings/ai/index.js`

**Interfaces:**
- Consumes: GET/POST `/_studio/ai` from Task 4 (`nlModels`, `nlModel`, POST `{ nlModel }`).
- Produces: UI only — no exported API.

No automated clause (Studio settings pages are browser-verified by hand — existing E2E debt in STATUS.md); the suite still must stay green.

- [ ] **Step 1: Implement the two-section page**

Replace the whole body of `render` in `src/studio/routes/settings/ai/index.js` (keep imports and the surrounding shape):

```js
export function render(ctx) {
    const c = {}
    const host = mountTemplate(aiTemplate(c))

    const p = (text, cls = "nx-muted") => {
        const node = document.createElement("p")
        node.className = cls
        node.textContent = text
        return node
    }

    async function load() {
        const r = await ctx.api.studio("ai", "GET")
        const d = r.ok ? r.data : {}
        c.$body.replaceChildren(
            p("Mode: " + (d.mode || "?") + " · " + (d.libInstalled ? "library installed" : "library NOT installed — run: nexus model pull"), d.libInstalled ? "nx-muted" : "nx-err")
        )
        section("Embedding", d.models || [], d.model, "model", "Keyword only", (m) => m.dims + "d · " + m.langs + " · " + m.size + " · " + m.note)
        section("NL (function calling)", d.nlModels || [], d.nlModel, "nlModel", "None — rule/retrieval tiers only", (m) => m.langs + " · " + m.size + " · " + m.note)
        c.$body.append(p("Download weights with the nexus model pull command (shows % + MB). Restart nexus dev to apply."))
    }

    // One model slot: a heading, a row per registry model, a clear button.
    function section(title, models, current, key, noneLabel, spec) {
        const h = document.createElement("h2")
        h.textContent = title
        c.$body.append(h)
        for (const m of models) {
            const active = m.id === current
            const row = document.createElement("div")
            row.className = "nx-row"
            const who = document.createElement("div")
            who.className = "nx-who"
            const name = document.createElement("div")
            name.textContent = m.name
            const detail = document.createElement("div")
            detail.className = "nx-pub"
            detail.textContent = spec(m)
            who.append(name, detail)
            const use = button({
                variant: active ? "primary" : undefined, disabled: active,
                onclick: async () => {
                    await ctx.api.studio("ai", "POST", { [key]: m.id })
                    toast("Model set — restart nexus dev to apply")
                    load()
                }
            }, [active ? "In use" : "Use"])
            row.append(who, use)
            c.$body.append(row)
        }
        const none = button({
            variant: current ? undefined : "primary", disabled: !current,
            onclick: async () => {
                await ctx.api.studio("ai", "POST", { [key]: null })
                toast(key === "model" ? "Switched to keyword search" : "NL tier off — rule/retrieval tiers remain")
                load()
            }
        }, [noneLabel])
        const toolbar = document.createElement("div")
        toolbar.className = "nx-toolbar"
        toolbar.style.marginTop = "var(--sp-3)"
        toolbar.append(none)
        c.$body.append(toolbar)
    }

    load()
    return host
}
```

Also update the file's top docstring to say the page manages BOTH the embedding and the NL model.

- [ ] **Step 2: Verify**

Run: `npm test` — everything stays green (no clause touches this file).
Manual check (dev box): `nexus dev` in a scratch instance → open `/settings/ai` → two sections render; "Use" on FunctionGemma writes `semantic.nlModel`; the NL "None…" button removes only that key.

- [ ] **Step 3: Commit**

```bash
git add src/studio/routes/settings/ai/index.js
git commit -m "Studio settings/ai: the NL model joins the page — two slots, same row language

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: STATUS.md + final sweep

**Files:**
- Modify: `STATUS.md`

- [ ] **Step 1: Update STATUS.md**

In the "Implemented & proven" table, replace the `NL → AST` row's clause list and text tail: after "validated against schema (injection-safe)" append:

```
; **NL model is first-class on every surface (create wizard defaults to FunctionGemma + `--nl-model`, two-slot `nexus model`, `/_studio/ai`, Studio /settings/ai)**
```

and change its clauses cell to `NL-*, **FG-***, **MODEL-07..09**`.

In "Unfinished / known drift", the FunctionGemma bullet stays (zero-shot quality is untouched by this work) — but append one sentence: "Enabling it no longer requires hand-editing config (MODEL-07..09)."

- [ ] **Step 2: Full suite + verify the flow end-to-end**

Run: `npm test`
Expected: previous green count + 3 new clauses (MODEL-07, 08, 09), 0 red.

Real-flow check (no downloads): in a scratch dir run
`node bin/nexus.js create demo --model none --nl-model onnx-community/functiongemma-270m-it-ONNX --json`
then confirm `demo/nexus.config.json` contains `"semantic": { "nlModel": "onnx-community/functiongemma-270m-it-ONNX" }` and no `model` key.

- [ ] **Step 3: Commit**

```bash
git add STATUS.md
git commit -m "STATUS: NL model surfaces are real (MODEL-07..09)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
