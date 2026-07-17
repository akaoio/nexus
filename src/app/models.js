/**
 * AI (embedding) models as a first-class concern (ARCHITECTURE.md §4.6b/§240):
 * EmbeddingGemma is the multilingual default; transformers.js is the INSTANCE's
 * dependency (N2 — never the kernel's), so "install a model" means installing
 * the library into the instance and warming the model's cache. This module is
 * the registry + the install/pull/status logic the CLI and Studio share.
 *
 * The configured model lives at `semantic.model` in nexus.config.json — the same
 * key the dev server reads to switch search/NL from lexical to semantic.
 */

/** Curated embedding models (ONNX, run locally via transformers.js). */
export const MODELS = Object.freeze([
    { id: "onnx-community/embeddinggemma-300m-ONNX", name: "EmbeddingGemma 300m", dims: 768, langs: "100+", size: "~200 MB", note: "default — multilingual, best quality" },
    { id: "Xenova/multilingual-e5-small", name: "multilingual-e5-small", dims: 384, langs: "100+", size: "~120 MB", note: "multilingual, lighter" },
    { id: "Xenova/all-MiniLM-L6-v2", name: "all-MiniLM-L6", dims: 384, langs: "English", size: "~25 MB", note: "fast, tiny, English-only" }
])

export const DEFAULT_MODEL = MODELS[0].id
const LIB = "@huggingface/transformers"

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

/** The model configured for a site, or null. */
export function currentModel(config) {
    return config?.semantic?.model ?? null
}

/** Return a config with `semantic.model` set to `id` (pure). */
export function withModel(config, id) {
    if (id && !MODELS.some((m) => m.id === id)) {
        // allow any HF id, but flag unknowns so the caller can warn
    }
    const next = { ...config, semantic: { ...(config?.semantic ?? {}), model: id } }
    if (!id) delete next.semantic.model
    return next
}

/** Is transformers.js installed in the instance? (resolved from its node_modules) */
export function libInstalled(root) {
    try {
        const { createRequire } = process.getBuiltinModule("module")
        const { join } = process.getBuiltinModule("path")
        createRequire(join(root, "package.json")).resolve(LIB)
        return true
    } catch {
        return false
    }
}

/**
 * Model + library status for a site: what's configured, whether the library is
 * installed, and the registry entry (if known).
 */
export function status(config, root) {
    const id = currentModel(config)
    return {
        model: id,
        known: id ? MODELS.find((m) => m.id === id) ?? null : null,
        libInstalled: libInstalled(root),
        mode: id ? (libInstalled(root) ? "semantic" : "configured-not-installed") : "lexical"
    }
}

/** Install transformers.js into the instance (real npm install). Node-only. */
export function installLib(root) {
    const { spawnSync } = process.getBuiltinModule("child_process")
    const result = spawnSync("npm", ["install", LIB], { cwd: root, encoding: "utf8", stdio: "pipe" })
    if (result.status !== 0) throw err("E_INSTALL", (result.stderr || result.stdout || "npm install failed").trim().split("\n").pop())
    return true
}

/**
 * Pull a model: ensure the library, then load the model once so its weights are
 * fetched into the transformers.js cache (~/.cache/huggingface). Returns the
 * model's real dimensions. Heavy (network + disk) — the CLI drives it, not tests.
 */
export async function pull(root, id = DEFAULT_MODEL) {
    if (!libInstalled(root)) installLib(root)
    const { transformersProvider } = await import("../semantic/transformers.js")
    const embedder = await transformersProvider({ model: id, root })
    // one embed forces the model to fully materialize
    await embedder.embed(["warm up"])
    return { model: id, dims: embedder.dims }
}

export default { MODELS, DEFAULT_MODEL, currentModel, withModel, libInstalled, status, installLib, pull }
