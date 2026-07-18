# Everything is an Entity — phased plan (compact)

> Executed inline by the designing session (author away, Codex reviews
> post-hoc). Spec: `2026-07-18-system-entities-studio-design.md`. Tests
> green + browser verification gate every phase commit.

## Phase 1 — system entities (core)

- [ ] `src/core/App/system.js`: SYSTEM_ENTITIES (nexus_user/role/policy +
      nexus_view), isSystem(), packPolicy/unpackPolicy (JSON text columns),
      SYSTEM_BASELINES (admin-full on system entities + self-service
      nexus_user write via $CURRENT_USER rule), importIdentities(). Pure,
      browser-loadable. Tests SYS-01..04 (test/app/system.test.js).
- [ ] `buildInstanceApi`: schemas += SYSTEM_ENTITIES (tables ensured);
      policyStore { baselines(files+system), rows, all(), refresh() };
      request ctx reads store.all(); DataPlane hook on nexus_policy
      mutations → refresh(); boot: importIdentities when table empty;
      rolesForPub resolves through nexus_user rows (config fallback).
- [ ] Studio boot: schemas payload marks system entities; Content nav
      hides them; permissions page reads baselines (labeled) + rows.

## Phase 2 — entity lifecycle

- [ ] Model Schema v1: field `span: 1|2|3` (FIELD_KEYS + validate + MS
      clause); form-builder/designer render 3-col grid, drag-drop order.
- [ ] `src/core/App/lifecycle.js`: entityDeletePlan() pure (+ tests
      LIFE-*); executor in dev.js: drop table, delete schema file, edit
      linking schema files (DROP link columns) via migrate, delete
      nexus_policy/nexus_view rows.
- [ ] dev.js: rebuildable api (model POST + entity delete hot-reload
      schemas/tables/API, no restart); `/_studio/entities` GET (rows for
      the list); `/_studio/entity-delete` GET plan / POST execute (typed
      name confirms).
- [ ] `/entities` route (renamed from /entity view "entity"→"entities",
      plural; client redirect old→new): nx-list-view of entities → edit
      screen (designer + views + Delete w/ plan modal).

## Phase 3 — RBAC pages

- [ ] `/roles`: CRUD over nexus_role rows; detail = description, policies
      granting through it, holders.
- [ ] `/users`: nexus_user rows; profile fields + multi-role checkboxes;
      add/remove; permissions decided by seeded policies only.
- [ ] permissions page on standard components; baselines read-only with
      source label; saves write nexus_policy rows (\_studio/permissions
      POST removed).

## Phase 4 — chrome

- [ ] Grid layout + `data-nav="full|icons"` toggle (persisted); mobile
      drawer unchanged.
- [ ] Header search (nx-search dropdown, "/" focuses); /search stays.
- [ ] nx-user menu: profile + sign out (flow exists, becomes visible).
