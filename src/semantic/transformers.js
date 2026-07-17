/**
 * Real embedding provider (§4.6b) — transformers.js running a real ONNX
 * model locally (EmbeddingGemma, all-MiniLM, …). This is a genuine semantic
 * embedder: synonyms with no shared words still land close, which the
 * deterministic lexical `hashProvider` cannot do.
 *
 * transformers.js is the INSTANCE's dependency, never Nexus's (N2) — it is
 * resolved from the instance's node_modules exactly like a DB driver, so the
 * kernel stays zero-dependency. hashProvider remains the honest offline
 * fallback (real, deterministic, lexical), not a fake; this is the semantic
 * upgrade an instance opts into.
 *
 *   npm install @huggingface/transformers
 *   const embedder = await transformersProvider({ model: "onnx-community/embeddinggemma-300m-ONNX", root })
 */

import { createRequire } from "module"
import { pathToFileURL } from "url"
import { join } from "path"

const err = (code, detail) => new Error(detail ? `${code}: ${detail}` : code)

async function importFrom(name, root) {
    try {
        return await import(name)
    } catch {}
    try {
        const require = createRequire(join(root ?? process.cwd(), "package.json"))
        return await import(pathToFileURL(require.resolve(name)).href)
    } catch {
        throw err("E_PROVIDER", `the embedding provider needs its library — run: npm install @huggingface/transformers`)
    }
}

/**
 * @param {Object} config
 * @param {string} [config.model] - HF model id (ONNX). Default all-MiniLM-L6-v2.
 * @param {string} [config.root] - Instance dir for resolving the library.
 * @param {boolean} [config.quantized=true]
 * @returns {Promise<{name, version, dims, embed(texts): Promise<number[][]>}>}
 */
export async function transformersProvider({ model = "Xenova/all-MiniLM-L6-v2", root, quantized = true } = {}) {
    const { pipeline } = await importFrom("@huggingface/transformers", root)
    const extract = await pipeline("feature-extraction", model, { quantized })
    const one = async (text) => Array.from((await extract(String(text), { pooling: "mean", normalize: true })).data)
    const probe = await one("dimension probe")
    return {
        name: model,
        version: 1,
        dims: probe.length,
        async embed(texts) {
            const out = []
            for (const text of texts) out.push(await one(text))
            return out
        }
    }
}

export default transformersProvider
