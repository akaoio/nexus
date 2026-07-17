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
 * EmbeddingGemma is trained with task-specific prompts: retrieval queries and
 * documents are embedded through DIFFERENT prefixes, and skipping them costs
 * real accuracy. These are Google's published retrieval prompts. Symmetric
 * models (all-MiniLM, …) use empty prefixes, so embed() and embedQuery()
 * coincide and every existing caller is unaffected.
 */
const GEMMA_PROMPTS = { query: "task: search result | query: ", document: "title: none | text: " }

function promptsFor(model, override) {
    if (override) return override
    if (/gemma/i.test(model)) return GEMMA_PROMPTS
    return { query: "", document: "" }
}

/**
 * The model's relevance floor — the cosine below which a match is noise, not
 * a result. Dense models score unrelated text well above zero (Gemma ~0.4,
 * e5 ~0.75 — e5's space is compressed), so search without a floor returns
 * everything for any query. Values from observed related/unrelated gaps.
 */
export function modelFloor(model = "") {
    if (/gemma/i.test(model)) return 0.5
    if (/\be5\b|multilingual-e5/i.test(model)) return 0.75
    if (/minilm/i.test(model)) return 0.3
    return 0.25
}

/**
 * The NL-intent threshold — stricter than the search floor, because intent
 * retrieval maps a phrase to an ACTION and a wrong guess is worse than a
 * refusal. Measured on EmbeddingGemma: real paraphrases score 0.71–0.84
 * against the schema intents, out-of-domain asks 0.53–0.57 — 0.65 splits
 * them with margin on both sides.
 */
export function modelNLThreshold(model = "") {
    if (/gemma/i.test(model)) return 0.65
    if (/\be5\b|multilingual-e5/i.test(model)) return 0.85
    if (/minilm/i.test(model)) return 0.35
    return 0.35
}

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
    const P = promptsFor(model, prompts)
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
        floor: modelFloor(model),
        nlThreshold: modelNLThreshold(model),
        /** Embed documents (the indexing side). */
        embed: (texts) => many(texts, P.document),
        /** Embed search queries (the retrieval side) — asymmetric for Gemma. */
        embedQuery: (texts) => many(texts, P.query)
    }
}

export default transformersProvider
