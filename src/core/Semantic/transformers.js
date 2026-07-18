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

// Per-model knowledge (prompts, floor, nlThreshold) lives in the MODEL
// PROFILES registry (App/models.js) — this file is pure mechanics. The
// import is one-directional: models.js reaches back only via dynamic
// import inside pull(), so no cycle exists.
import { profileFor } from "../App/models.js"

/**
 * @param {Object} config
 * @param {string} [config.model] - HF model id (ONNX). Default EmbeddingGemma-300m.
 * @param {string} [config.root] - Instance dir for resolving the library.
 * @param {boolean} [config.quantized=true]
 * @param {{query: string, document: string}} [config.prompts] - override task prefixes.
 * @returns {Promise<{name, version, dims, prompts, embed(texts), embedQuery(texts)}>}
 */
export async function transformersProvider({ model = "onnx-community/embeddinggemma-300m-ONNX", root, quantized = true, prompts, onProgress } = {}) {
    const { pipeline } = await importFrom("@huggingface/transformers", root)
    // progress_callback streams { status, file, loaded, total, progress } while
    // the weights download — the CLI/Studio turn it into % and MB.
    const extract = await pipeline("feature-extraction", model, { quantized, progress_callback: onProgress })
    const profile = profileFor(model)
    const P = prompts ?? profile.prompts
    const one = async (text, prefix = "") =>
        Array.from((await extract(prefix + String(text), { pooling: "mean", normalize: true })).data)
    const probe = await one("dimension probe", P.document)
    const many = async (texts, prefix) => {
        const out = []
        for (const text of texts) out.push(await one(text, prefix))
        return out
    }
    return {
        name: model,
        version: 1,
        dims: probe.length,
        prompts: P,
        floor: profile.floor,
        nlThreshold: profile.nlThreshold,
        /** Embed documents (the indexing side). */
        embed: (texts) => many(texts, P.document),
        /** Embed search queries (the retrieval side) — asymmetric for Gemma. */
        embedQuery: (texts) => many(texts, P.query)
    }
}

export default transformersProvider
