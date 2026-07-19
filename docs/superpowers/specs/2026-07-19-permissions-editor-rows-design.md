# Permissions editor on nexus_policy rows — design

**Date:** 2026-07-19
**Problem:** The Studio permissions page edits `apps/<app>/permissions/studio.json`
through a bespoke endpoint (`/_studio/permissions` GET/POST). The live row
layer (`nexus_policy`) exists and is enforced, but the editor neither reads
nor writes it — and it sees only ONE of the four policy layers the engine
composes, so the matrix verdict it renders is not the truth the engine runs.
Two write paths to the same concern is exactly the drift this project's
system-entities design (2026-07-18) said must die.

**Decision (approach A):** the editor reads all layers through one read-only
window built from the engine's own runtime arrays, and writes through the
ordinary Data Plane only. The bespoke write path dies. Durability comes from
three things: an additive composition contract pinned by a conformance
clause, write-side validation, and read-side tolerance.

## 1. The composition contract (the hundred-year invariant)

Effective policies = `app-file policies ∪ SYSTEM_BASELINES ∪
adminBaselines(schemas) ∪ nexus_policy rows` — a **purely additive union**
under deny-by-default. No layer can revoke, shadow, or reorder a grant from
another layer. Consequences, stated deliberately:

- Baselines are the floor. What an app file grants, the Studio cannot turn
  off — changing the floor is a git-tracked file edit by the app's author.
  Runtime data never overrides code's commitment; "who may do what" always
  traces to either git or the rows table, never to an interaction between
  them.
- This contract is pinned by a conformance clause (golden-invariant style):
  for policy layers A and B and any (roles, entity, action) probe,
  `resolve(A ∪ B)` grants iff `resolve(A)` grants or `resolve(B)` grants.
  Changing composition semantics later makes the suite red.

There is no migration machinery: no production installs exist yet, and
`studio.json` simply loses its special status — it remains an ordinary app
baseline file loaded by `loadPolicies` like every other `permissions/*.json`.
The editor stops writing it; nothing else changes.

## 2. The read window — `GET /_studio/policies` (dev-only, read-only)

Returns the layered truth, built from the SAME runtime arrays the engine
composes in `livePolicies()` (`appPolicies`, `SYSTEM_BASELINES`,
`shippedAdmin`, `dbPolicies` with row ids) — never re-loaded from disk, so
the UI cannot drift from the engine:

```json
{
  "layers": [
    { "source": "app:starter/permissions/team.json", "readonly": true,  "policies": [] },
    { "source": "system", "readonly": true,  "policies": [] },
    { "source": "admin",  "readonly": true,  "policies": [] },
    { "source": "rows",   "readonly": false, "policies": [{ "id": "…", "entity": "…" }] }
  ],
  "devMode": true,
  "authRequired": false
}
```

- App-file policies are labeled per source file: `loadPolicies` stamps a
  `source: "app:<file>"` annotation onto each policy object at load time
  (an extra key — `validatePolicy` ignores unknown keys and `resolve`
  consumes only its own fields, same precedent as the `roles` annotation).
  The label therefore lives on the very objects the engine composes; the
  window never re-reads disk to reconstruct it.
- The `rows` layer carries each policy in unpacked (Permission v1) form
  plus its row `id`.
- Read endpoints are not a drift risk; writes were. This endpoint never
  accepts a mutation.

## 3. The write path — Data Plane only, defended on both sides

- All writes go through the ordinary entity API: `/api/v1/nexus_policy`
  create/update/remove per row. No permission-specific write endpoint
  exists anywhere. The existing `after:create/update/remove` hooks already
  hot-refresh `dbPolicies` — a Studio save is a live grant with no restart
  and no new mechanism.
- **Write-side defense:** `before:create` and `before:update` hooks on
  `nexus_policy` validate the unpacked policy with `validatePolicy`
  (against loaded schemas). Invalid rows — broken rule AST, unknown
  action, permlevel outside 0–9, malformed roles — are rejected with the
  validator's error codes. The same law binds direct API callers and the
  Studio; there is no privileged writer.
- **Read-side defense:** `refreshPolicies` becomes tolerant. A row whose
  JSON columns fail to unpack (corruption, out-of-band writes, partial
  sync) is SKIPPED with a logged warning — never thrown. A single bad row
  must never take down the auth layer. (Write validation makes this path
  rare; tolerance makes it survivable.)

## 4. The editor — the page tells the whole truth

- `/permissions` renders every layer: baselines read-only with their
  source labels; the `rows` layer editable.
- `<nx-permission-manager>` keeps its array contract. Row policies carry
  their `id` as an opaque pass-through key (`validatePolicy` ignores
  unknown keys; `packPolicy` strips them on write).
- Save keeps the explicit-button UX but is a diff by id underneath:
  value entries without `id` → `api.create`; with `id` and changed
  content → `api.update`; ids present before but absent from the value →
  `api.remove`. Results toast per outcome; the page reloads the window
  after.
- The matrix verdict computes over the FULL composed set (all read-only
  layers + the rows being edited) — the blindness of the old page is the
  bug being fixed.
- The roles overview stops calling legacy `/_studio/users`; it reads
  `nexus_user` rows through the entity API exactly as the `/users` page
  does (`rolesIn(policies, users)`).
- The DEV-mode banner stays: policies bite only once auth is on.

## 5. What dies

- `GET /_studio/permissions` and `POST /_studio/permissions` are removed
  from dev.js. A conformance clause pins both to 404.
- No file writes to `apps/<app>/permissions/` happen from the Studio,
  ever again.

## 6. Error handling

- Entity API write failures (validation, permission) surface per-row in
  the save toast with the error code; the page re-syncs from the read
  window so partial saves are visible truthfully rather than masked.
- `GET /_studio/policies` has no failure modes beyond the server being
  down; it reads memory.
- A skipped (corrupt) row appears in no layer; the log line names the row
  id so an operator can repair or delete it through the API.

## 7. Testing (spec-first, clauses RED before code)

- **Composition invariant:** the union clause of §1 over generated layer
  pairs (pure, engine-level).
- **Write defense:** invalid `nexus_policy` create/update rejected through
  the real plane (each validator error class probed once); valid ones
  land and hot-refresh (existing SYS hooks clauses extended).
- **Read tolerance:** a deliberately corrupted row (raw executor write) —
  server boots, auth still works, row skipped, warning logged.
- **Read window:** `GET /_studio/policies` returns all four layers; the
  flattened union equals the set the engine enforces (probe: a grant that
  exists only in an app file, one only in rows — both visible and both
  enforced on `/api/v1`).
- **Endpoint death:** GET and POST `/_studio/permissions` → 404.
- **Editor save:** real dev server — a create + an update + a remove in
  one save round-trip land as rows and refresh enforcement (CLI-level
  clause driving the API the page uses; the page itself joins the manual
  browser pass, per the existing E2E debt).

## Out of scope

- The fate of the remaining legacy `/_studio/users` endpoints (the
  permissions page merely stops depending on them; deciding
  keep-as-bootstrap vs delete is its own item).
- Any deny/override mechanism (rejected by decision in §1).
- Per-field (permlevel > 0 column security) UI beyond what the manager
  already exposes.
