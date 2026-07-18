# Studio akao discipline + design language + settings tree

**Date:** 2026-07-18 · **Status:** executing (author away; Codex reviews post-hoc)
**Branch:** `studio-akao-discipline` (functiongemma-nl already merged to main)

The author's 10 findings, consolidated into clusters. The akao reference
(`~/Projects/akao/src/UI`) is the structural norm: UI holds ONLY
`components/ css/ layouts/ routes/` (+ `threads/` in nexus); route folders are
`index.js + template.js (+ logic.js, styles.css.js)`; shared machinery never
floats at top level.

## A — file discipline (structure only, no behavior change)

Top level shrinks to `app.js` (the served entry) + folders:

| stray | new home | why |
|---|---|---|
| `kit.js` | `kit/index.js` (factories, mount, toast, confirm) + `kit/api.js` + `kit/i18n.js` + `kit/theme.js` | machinery folder, public surface = index.js (the component-index rule) |
| `cache.js` | `kit/cache.js` | machinery |
| `fields.js` | `kit/fields.js` | shared field-control registry |
| `selection.js` | `kit/selection.js` | pure model |
| `webauthn.js` | `kit/webauthn.js` | machinery |
| `views.js` (saved views) | `src/core/Views.js` | Data-Plane business logic, not UI; `sortRows`/`groupRows` pure halves move with it, `<nx-list-view>` imports them from core |
| `views/` (renderer registry) | stays (`views/index.js`, `list.js`, `kanban.js`) | it IS the akao views shape |
| `navigators.js` | deleted | orbit removed (finding 10) |
| `components/navigator/` | deleted | same |
| `shell.js` | `layouts/studio/shell.js` | the layout owns the page frame (server half) |

## B — routes: settings is the parent (findings 1, 8, 10)

- Route patterns: `/entity/[entity]`, `/settings/[feature]`, `/[view]`.
- `routes/settings/` gains children folders: `ai/` (moved from `routes/ai/`,
  click-bug fixed in passing), `locales/`, `themes/` — URL shape
  `/<locale>/settings/<feature>`. Sidebar lists the children indented under
  Settings; the orbit navigator and its hamburger die.
- Locale/theme switching move from orbit planets to the two settings pages.
- The header model badge (`semantic · embeddinggemma-300m`) is removed;
  that status lives only in Settings → AI.

## C — design language (findings 2, 6, 7)

- **Square:** `--radius: 0; --radius-sm: 0`; sweep any hardcoded
  `border-radius`/`50%` out of studio css + component styles.
- **Borders → tints:** controls, cards, inputs, buttons drop `border` lines
  for `--surface-2` / `--accent-soft` backgrounds (`--border` stays only where
  a separator is structural, e.g. table header rule).
- **Accent:** default becomes limegreen (`--h2: 120; --s2: 61%`). New accent
  presets (limegreen, amber, blue, violet, red, cyan) selectable in
  Settings → Themes; stored in `localStorage("nexus-accent")`, applied as
  `--h2/--s2` overrides on `:root` by `kit/theme.js`.
- **Fixed toggles:** view-switcher buttons keep variant `icon` permanently;
  active state is `data-on` (accent tint) — dimensions never change.

## D — views are schema-declared (finding 5)

- Model Schema v1 gains optional `views: [string…]` (unique, non-empty,
  `[a-z][a-z0-9_]*`) — vocabulary stays open in core; the STUDIO registry
  decides what renders. MS conformance gains the clause.
- Studio rule: no `views` key → list only; kanban renders only when declared
  AND `boardField` exists. Schema-designer gets a views checklist; the
  starter model and my-app's task.json declare `["list","kanban"]`.

## E — roles as first-class (finding 9)

- A role is a NAME that bundles policies (policy.roles gates already exist in
  `App/policies.js`); identities carry role lists. What's missing is
  management: the permissions route gains a Roles panel (roles derived from
  policies + identities; assign/unassign a policy to a role; see which users
  hold it) persisted through the existing `/_studio` config/users endpoints —
  no new permission semantics in core (deny-by-default untouched).

## F — Data model + Search redesign (findings 3, 4)

Both pages rebuilt on the new design language: clear hierarchy, schema
designer with views/fields sections, search with mode context and readable
result rows. Structure in template.js, style in styles.css.js (triads).

## G — model profiles (the hardcode complaint from the same session)

- `src/core/App/models.js` becomes the single model-knowledge registry:
  embedding entries gain `prompts/floor/nlThreshold`; a new NL section
  carries the FunctionGemma entry. `Semantic/transformers.js` keeps only
  mechanics (`promptsFor/modelFloor/modelNLThreshold` become registry
  lookups with the current values as defaults for unknown ids);
  `llmNLProvider({ generate, parse = parseCall })` completes the seam.

## Verification

Full suite green after every cluster; `nexus dev` restarted and every touched
page driven through Claude-in-Chrome (sidebar nav, settings children, accent
switch, view toggle fixed-size, data model save, search) before the cluster's
commit is considered done.
