# NL model as a first-class surface — design

**Date:** 2026-07-19
**Problem:** FunctionGemma (NL tier 4) cannot be enabled from any surface.
`nexus create` asks only for the embedding model; `nexus model` operates only
on `semantic.model`; the Studio `/settings/ai` page never mentions the NL
model; `NL_MODELS` in `App/models.js` is dead weight. The only way to turn
tier 4 on is hand-editing `semantic.nlModel` in `nexus.config.json`.

**Decision:** NL model becomes first-class, symmetric with the embedding
model, on all four surfaces: `nexus create`, `nexus model`, `/_studio/ai`,
Studio `/settings/ai`. One core registry drives them all.

## 1. Core — `App/models.js` becomes a two-slot registry

Every per-model fact stays in `App/models.js` (the studio-akao-discipline
decision). Additions:

- `DEFAULT_NL_MODEL = NL_MODELS[0].id` moves here as the single source.
  `NL/llm.js` imports it instead of declaring its own copy (dedupe; no
  import cycle — `NL/llm.js` already sits above `App/`).
- `kindOf(id)` → `"embedding" | "nl" | null` — membership lookup across the
  two registries. Unknown ids return `null`.
- `currentNlModel(config)` / `withNlModel(config, id)` — pure, exact mirrors
  of `currentModel`/`withModel`, reading/writing `semantic.nlModel`.
- `status(config, root)` gains the NL slot: `nlModel`, `nlKnown` (registry
  entry or null). `mode` keeps its embedding meaning (back-compat).
- `pull(root, id)` dispatches on `kindOf(id)`: embedding ids keep the
  current path (transformersProvider + one embed); NL ids ensure the
  library, then warm via `functionGemmaGenerator` + one tiny generate so
  the weights fully materialize. Returns `{ model: id }` (no dims for NL).

## 2. `nexus create`

- After the embedding question, ask **"NL (function calling) model"** —
  options from `NL_MODELS` plus `none`. **Default (Enter) = FunctionGemma**:
  symmetric with the embedding question, tier 4 on by default in the wizard.
- Chosen model is written to `semantic.nlModel` in the scaffolded
  `nexus.config.json` (omitted entirely for `none`, same style as
  `semantic.model`).
- Non-interactive flag: `--nl-model <id|none>`. With no flag and no TTY
  (CI, `--yes`, `--json`, piped) **nothing is written** — CI never
  surprise-downloads ~300 MB.
- The existing "Download now?" offer pulls **both** chosen models; the
  summary line and "Next steps" hint (`nexus model pull`) cover both.
- `out.emit` gains `nlModel` next to `model`.

## 3. `nexus model` CLI

- `list` — two sections, **Embedding** and **NL (function calling)**, each
  with its own "● in use" marker per slot.
- `status` — prints both slots.
- `use <id>` — slot inferred via `kindOf(id)`. `use none` clears the
  embedding slot (back-compat); `use none --nl` clears the NL slot. An id
  unknown to both registries defaults to the embedding slot as today, with
  `--nl` forcing the NL slot.
- `pull` (no id) — warms **every configured model** (both slots; skips
  empty slots; falls back to `DEFAULT_MODEL` when neither is set, as
  today). `pull <id>` — that model only; if the corresponding slot is
  empty, record the id into it (existing embedding behavior, generalized).

## 4. Dev server `/_studio/ai`

- GET returns the extended `status(...)` plus `models: MODELS` and
  `nlModels: NL_MODELS`.
- POST accepts `{ model }` (existing) and/or `{ nlModel }` — each key
  present is applied to its slot via `withModel`/`withNlModel`; absent keys
  untouched. Response shape unchanged plus `nlModel`.

## 5. Studio `/settings/ai`

Two sections on the same card pattern (no new DOM idioms):

- **Embedding model** — the existing rows + "Keyword only" button.
- **NL model** — rows from `nlModels` + a "None — tiers 1–3 only" button.
  Use/None POST `{ nlModel }`; same "restart to apply" toast as embedding.

## 6. Error handling

- Unknown model ids: `use` warns but writes (today's embedding behavior),
  `--nl` routes the slot; `create --nl-model` accepts any id (flag is
  explicit intent).
- `pull` failures keep the existing error path (`E_INSTALL`/message →
  non-zero exit; create's inline pull prints the warning + hint).

## 7. Testing (spec-first, clauses RED before code)

- **Registry:** `kindOf` classifies every curated id + unknown → null;
  `withNlModel` purity + unset-on-null (mirror of the `withModel` clauses);
  `status` reports both slots.
- **create:** non-interactive `--nl-model` writes `semantic.nlModel`;
  no flag → key absent; `none` → key absent (real-process CLI clause).
- **model CLI:** `use` routes each curated id to its slot; `use none --nl`
  clears only the NL slot; `list --json` exposes both groups.
- **/_studio/ai:** GET carries `nlModels` + NL status; POST `{ nlModel }`
  writes `semantic.nlModel` and leaves `semantic.model` alone.
- Studio page verified by hand in the browser (joins the existing E2E debt
  noted in STATUS.md).
- Heavy pulls (real downloads) stay out of the suite, as today.

## Out of scope

- Fine-tuning FunctionGemma / improving zero-shot quality (separate track,
  noted in STATUS.md).
- Pinning generator `dtype` (open item, unchanged).
- More NL registry entries — the registry format already admits them.
