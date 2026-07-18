# Everything is an Entity: system entities, entity lifecycle, RBAC, chrome

**Date:** 2026-07-18 · **Status:** approved (4 areas in one design session)
**Branch:** `studio-akao-discipline` (continues)

The author's 13 findings, resolved into four phased areas. Decisions made
interactively: files stay the source of truth for entity meta (nexus_entity
is a Data-Plane VIEW whose writes go through a file adapter + hot reload);
app permission files are read-only shipped BASELINES merged under DB rows;
entity deletion cascades destructively behind a dry-run plan + typed
confirmation; field layout is schema data (`span: 1|2|3` on a grid).

## Naming (finding 1, 6)

One word, one concept: **Entity = the definition**. The builder page is
**Entities** at **`/entities`** (vi: Thực thể). The content sidebar group
relabels **Content** (vi: Dữ liệu). Builder routes are all plural:
`/entities /permissions /users /roles /settings /search`. Content rows stay
at `/entity/<name>` — singular + name reads as "one specific entity", and
deep links survive. `/entity` (bare) redirects to `/entities` client-side.

## Phase 1 — system entities (finding 9, foundations for 7/8/13)

`src/core/App/system.js` declares builtin Model Schema v1 documents +
`isSystem(name)`:

- `nexus_user`: pub (text, required, unique), name, email, avatar, bio,
  locale, `roles` (text, JSON array — Frappe Has Role, many per user)
- `nexus_role`: name (text, required, unique), description
- `nexus_policy`: entity, actions (text JSON), rule (text JSON), permlevel
  (integer), ifOwner (boolean), roles (text JSON), description
- `nexus_view` (already in core/Views.js) joins the registry

They run the SAME pipeline as any entity (validate, DDL, permission,
search) — no special code paths. `system: true` lives in the REGISTRY (code
owns the flag): Studio cannot delete them or edit their structure; their
ROWS are ordinary data.

- **Auth via plane:** login verifies signature, then resolves roles from
  the `nexus_user` row by pub. `nexus.config.json` identities become
  bootstrap-only: imported into `nexus_user` on first boot (empty table),
  and still honored as fallback when the table has no match (never locked
  out).
- **Policy merge:** effective policies = app-file baselines (read-only,
  source-labeled) + `nexus_policy` rows (Studio CRUD). The permissions page
  writes ROWS through the ordinary entity API — `/_studio/permissions` POST
  dies.
- **Self-service Frappe-style, as DATA:** nexus ships baseline policies
  (in system.js, not an app): role `admin` gets full access to every
  system entity; every authenticated user gets read on nexus_user/role and
  write on nexus_user restricted by rule
  `{field: "pub", operator: "eq", value: "$CURRENT_USER"}` — the engine
  already resolves `$CURRENT_USER`; no if-admin branches anywhere.
- `nexus_entity`: a special READ view over loaded schemas (list through
  the plane like everything else); its writes route to the schema-file
  adapter (phase 2). Meta stays git-diffable.

## Phase 2 — entity lifecycle at `/entities` (findings 2, 3, 4 + hot reload)

- **List:** `<nx-list-view>` over entity rows (name, label, app source,
  fields, views, row count — served by `/_studio/entities` GET). Click a
  row → the edit screen (designer + views checklist + Delete).
- **Delete with a cascade plan:** `entityDeletePlan()` is a PURE core
  function (App/lifecycle.js): given schemas + policies + views + target it
  returns the full plan (rows/table/embeddings, schema file, DB policies,
  orphaned baselines flagged, link-columns to DROP in other entities,
  saved views, roles losing grants). `/_studio/entity-delete` GET returns
  the plan (dry run); POST executes it after the client sends the typed
  entity name back. Executor drops the table, deletes the schema file,
  edits linking schema files (DROP column) through the migrate machinery,
  deletes nexus_policy/nexus_view rows.
- **Hot reload:** every `/_studio/model` write and entity delete rebuilds
  schemas + `ensureTables` + the API surface inside the running dev server
  — "restart nexus dev to apply" copy dies.
- **Field order + span:** designer rows drag-drop (HTML5 DnD) in addition
  to the arrows; Model Schema v1 field gains optional `span: 1|2|3`
  (default 3 = full row) — MS clause added; forms render on
  `grid-template-columns: repeat(3, 1fr)` with `grid-column: span n`.
  Nothing hardcodes a layout.

## Phase 3 — RBAC pages (findings 5, 7, 8, 13)

- **`/roles`:** list + create + rename + delete over `nexus_role` rows
  (ordinary entity API). A role's detail shows and edits: description, the
  policies that grant through it, the users who hold it.
- **`/users`:** professional: list `nexus_user` rows; edit = profile
  fields + ROLE CHECKBOXES (multi-role, from nexus_role); add by pub;
  remove. WHO may edit WHOM is decided entirely by the seeded policies
  (admin all, self via $CURRENT_USER rule) — zero hardcode.
- **Permissions page** rebuilt on standard components (kit factories,
  option tiles) — no ad-hoc DOM; baselines render read-only with their
  app source label.

## Phase 4 — layout & chrome (findings 10, 11, 12)

- **Grid layout, 3 nav states:** `data-nav="full|icons"` on the root, a
  toggle pinned at the sidebar top, persisted in localStorage; mobile keeps
  the off-canvas drawer. Pure CSS grid — column width flips by attribute.
- **Search in the header:** an `<nx-search>` box center-top, "/" focuses
  it, results drop over the page; `/search` route stays for deep links.
- **Sign-out visible:** nx-user gains a proper menu (identicon → menu:
  profile, sign out) — the confirm-and-signout flow already exists; it
  becomes discoverable. Profile links to `/users` (own row).

## Verification

Suite green after each phase (new clauses: system registry, delete plan,
span validation, policy merge); dev server restarted; every page driven in
Chrome (entities list/edit/delete plan, roles CRUD, users multi-role,
sidebar states, header search, logout) before the phase commit is final.
