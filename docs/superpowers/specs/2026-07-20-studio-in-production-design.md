# Studio in production — design

**Date:** 2026-07-20
**Issue:** #10
**Depends on:** the security hardening branch (issue #9's Criticals — PR #11). Nothing here may start before that lands: opening the Studio to production while `/_studio/*` merely authenticated would have handed every signed-in user `token_secret`.

**Problem:** `nexus start` serves four things and no admin UI at all: `/_health`, the ZEN handshake, `/api/v1/*`, and static files under the instance's `public/`. There is no `/_studio/*` branch, no `/_nexus/*` branch, no SPA shell, and `studioIndex()` is not imported (pinned by START-03). So administering a deployed instance means hand-calling the API with an admin token, using the CLI on that box, or — the thing operators actually do — running `nexus dev` against production data to "get into the Studio for a minute". That last option is the real risk this spec exists to remove.

**Decision:** the Studio runs in production, minus a named set of operations. The exclusions are enforced by **structure, not by a mode flag** — the excluded surface is not "disabled in production", it is absent from the code path production runs.

## 1. What runs in production, and what does not

The mapping is not a guess: every route's dependencies were traced (issue #10). Most of the Studio already talks only to `/api/v1`.

| Surface | In production | Why |
|---|---|---|
| Data browsing/editing (`entity/[entity]`) | **yes** | already pure `/api/v1` |
| `/users`, `/roles`, `/permissions` | **yes** | writes already go through `nexus_policy`/`nexus_user` rows; only the read-only baseline layers need a home (§3) |
| `/jobs` (DLQ, retry) | **yes** | already pure `/api/v1` |
| `/search`, `settings/locales`, `settings/themes` | **yes** | API / boot payload / client state |
| Login, session | **yes** | the handshake already exists in `start.js` |
| Schema designer (`/entities`: create/edit/delete entities) | **no, v1** | needs authorization + transactional DDL first (§5) |
| `settings` general panel (arbitrary config dot-path) | **never in this shape** | an arbitrary setter over the file holding `api_keys`/`token_secret` has no safe version |
| `settings/ai` (model config writes) | **no, v1** | same config-write class; revisit with a narrow allowlist |
| `/_nexus/*` framework source, `/__dev_events`, HMR | **never** | production must not serve `src/` |

**The v1 line, stated once:** production gets the whole data plane of the Studio; it does not get schema editing or config writing. An operator manages *data, users, roles, permissions and jobs* through the UI, and changes *structure* through git and a deploy.

## 2. The four mechanisms that keep this from drifting

The point is not this release's boundary; it is that the boundary cannot rot.

### 2.1 One declared route table, fail-closed

PR #11 already introduced `src/cli/dev-access.js` — `STUDIO_ACCESS` (path → required role), `accessFor()` defaulting to `"admin"`, and an invariant clause asserting every `/_studio/` route in `dev.js` appears in the table. That table gains a second axis:

```
{ path, roles: "admin" | "any", modes: ["dev"] | ["dev", "production"] }
```

**`modes` has no default.** An entry that does not declare it is dev-only. Forgetting is safe; opening a route to production is a deliberate, reviewable line in one file. An invariant clause asserts the set of routes production actually answers equals the set declared `production` — adding a route without declaring it fails the suite, and behaves dev-only meanwhile.

### 2.2 "Sensitive" becomes a permission question, not a mode question

Three classes, handled three ways:

- **(A) Already redundant** — `/_studio/entities` (schema list + row counts) and the rows half of `/_studio/policies` duplicate what `/api/v1` can answer. **Delete them**; the Studio calls the ordinary API. Nothing left to gate.
- **(B) Needs a server route, but should be policy-gated** — the read-only baseline layers of `/_studio/policies` become a normal authenticated read. Schema writes and entity-delete stay dev-only in v1 (§5), but when they graduate they graduate as `/api/v1` routes under the policy engine, not as privileged side doors.
- **(C) Permanently dev-only** — `/_nexus/*`, `/__dev_events`, the request-time CSS composition, the arbitrary-dot-path config setter.

The payoff is drift resistance: a new endpoint that forgets a mode check is still refused by deny-by-default, because the policy engine — not a conditional — decides.

### 2.3 Class C lives where production cannot reach it

Not "imported but unmounted" — **not imported**. The dev-only handlers move into a module `start.js` has no path to, and a clause asserts `start.js`'s import graph never reaches it. Leaking class C then requires *adding an import*, which is visible in a diff, rather than deleting a condition, which is invisible.

### 2.4 The Studio ships as static assets

The blocker was never permissions; it was module serving. Studio JS reaches the browser through `/_nexus/*`, which serves **any** file under `src/` and `vendor/` — including `auth.js` and `jobs.js`, which a browser has no business reading. `start.js` deliberately has no such route, and that omission *is* the SEC-01..04 boundary.

So: a build step copies the browser-needed subset into `public/studio/` (the instance's own directory), and production serves it through the **static route it already has**. Zero new server surface. No bundler is needed — nexus is zero-dep and the Studio is ES modules; the step walks `app.js`'s import graph and copies the files it reaches, rewriting `/_nexus/src/...` specifiers to relative paths.

The step is `nexus studio build`, run by `nexus create`, `nexus update`, and on demand. If `public/studio/` is absent, production simply has no Studio — the same as today, no error, no half state.

## 3. What has to change, concretely

- **`dev-access.js`** gains the `modes` axis + the production-set invariant clause.
- **Delete** `/_studio/entities`; the entity list comes from the boot payload's schemas plus per-entity counts through `/api/v1/:entity/query`.
- **`/_studio/policies`** splits: the read-only baseline layers become an authenticated `GET /api/v1/_policy-layers` (admin-only via ordinary policy, not a bespoke gate); the rows layer is deleted (the page already reads `nexus_policy` directly).
- **`/_studio/session`** moves to `/api/v1/_session` so the login UI works in both modes with one contract. After PR #11 it reports live-directory roles, so it is safe to expose; anonymous callers still get `{ authRequired, user: null, roles: [] }` and nothing else.
- **`nexus studio build`** — the copy step, plus `.gitignore` for `public/studio/`.
- **`start.js`** serves the Studio shell for Studio routes when `public/studio/` exists (a small SPA fallthrough scoped to the declared route list — the same `routeMatches` discipline dev.js already uses, so a file-looking path never reaches the shell).
- **Studio routes** that call deleted endpoints switch to `/api/v1`, including the `roles` page's call to `/_studio/permissions` — **a route deleted in the permissions-on-rows work that the page still calls today**, so `grantingBase` is always empty and the roles page silently under-reports. Fix regardless of this spec.

## 4. Error handling

- No `public/studio/` → production serves no Studio (404 as today). Not an error; the deployment simply did not build it.
- A Studio route reached in production whose data endpoint is dev-only → the route must not exist in the production build's navigation. The nav is derived from the same declared table, so this cannot drift silently.
- `nexus studio build` failing (missing source, unreadable path) is loud and leaves any previous `public/studio/` untouched — a failed build never yields a half-copied UI.

## 5. Deferred, deliberately

**Schema editing in production is out of scope for v1** and the reasons are specific, not squeamish: `/_studio/model` writes a file *and* hot-reloads the instance in-process (`reloadInstance` tears down and rebuilds the plane, API and effects while requests are in flight — dev.js's own comment calls the orphaned-handle cost "a dev-only cost, taken deliberately"), and entity-delete performs raw file rewrites plus raw DDL with no transaction (issue #9 I8). Both need real work before they face production traffic.

This means `README.md:48`'s comparison row — *"Schema changes in production: ✅ hybrid: additive = instant"* — remains **not true of shipped code** after this spec. Either the row is corrected to describe the design contract explicitly (the footnote at `README.md:61` already reserves that), or it stays a known overclaim. **Correct the row.** The whole point of this exercise is that STATUS and README describe what runs.

## 6. Testing

- **Invariant:** the set of `/_studio` routes production answers equals the set declared `modes: [… "production"]`; an undeclared route is dev-only (clause fails if a route is added without declaring).
- **Invariant:** `start.js`'s import graph does not reach the dev-only module.
- `nexus start` with `public/studio/` present serves the shell and its assets; without it, 404 — both pinned.
- `/_nexus/*` and `/__dev_events` remain 404 under `nexus start` (existing START-03 extended).
- A non-admin in production is refused the admin-only Studio endpoints and permitted the data routes their policies allow — the same authorization path `/api/v1` uses, proven on a real auth-on instance.
- `nexus studio build` produces a tree that imports cleanly (every specifier resolves within `public/studio/`), asserted by walking the output rather than by trusting the copier.
- The browser render pass joins the existing manual E2E debt; the transport, the route set and the authorization are what clauses pin.

## Out of scope

Schema editing and config panels in production (§5) · a Windows/macOS service story (issue #8) · row-level list patching in the Studio · bundling/minification beyond the copy step · any change to what `/api/v1` itself exposes.
