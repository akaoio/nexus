# Studio in Production Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `nexus start` serves the Studio's whole data plane (data, users, roles, permissions, jobs, search, settings/locales+themes) while schema editing and config writing remain absent from the production code path — enforced by structure, not by a mode flag.

**Architecture:** `dev-access.js`'s declared table gains a `modes` axis with **no default** (undeclared = dev-only), pinned by an invariant clause. Exactly two endpoints the production routes depend on move to the versioned API (`/api/v1/_session`, `/api/v1/_policy-layers`); everything else dev-only simply stays in `dev.js`, which `start.js` never imports — a fact a clause asserts. The Studio itself ships as static assets: `nexus studio build` walks `app.js`'s import graph and copies the browser subset into `public/studio/`, so production serves it through the static route it already has and `/_nexus/*` stays dev-only forever.

**Tech Stack:** Node ESM zero-dep kernel; repo conformance harness (`npm test`, explicit registration in `test.js`); real-process dev/start server clauses.

**Spec:** `docs/superpowers/specs/2026-07-20-studio-in-production-design.md` · **Issue:** #10

## Global Constraints

- Spec-first TDD (N6): every clause RED before its fix. Baseline: 566 green / 0 red / 53 skipped; stays 0 red.
- **`modes` has no default** — an entry that omits it is dev-only. Opening a route to production is one deliberate line in `dev-access.js`.
- Production must never gain `/_nexus/*`, `/__dev_events`, request-time CSS composition, or any config-writing route. START-03's 404 assertions stay green.
- The Studio in production talks ONLY to `/api/v1` — no bespoke gate, no privileged side door. Authorization is the same policy engine `/api/v1` already uses.
- No `public/studio/` → production has no Studio (404), not an error and not a half state.
- Commit style: repo sentence style; every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

**One deliberate deviation from the spec.** Spec §3 says delete `/_studio/entities` and rebuild the entity list from the boot payload. This plan does not: that endpoint feeds only the schema designer, which §5 keeps **out of production entirely**. Deleting it therefore rewrites a dev-only page's data source for zero production benefit, and touches the designer — the surface most likely to change when schema editing graduates. It stays dev-only, declared in the table like everything else. Recorded in STATUS as a known spec-to-code delta, not forgotten.

---

### Task 1: The `modes` axis

**Files:** Modify `src/cli/dev-access.js` · Test `test/http/studio.test.js`

**Interfaces produced:** entries become `{ roles: "admin"|"any", modes: ["dev"] | ["dev","production"] }`; `accessFor(path)` keeps returning the role (undeclared → `"admin"`); new `modesFor(path)` returns the declared modes (undeclared → `["dev"]`); new `PRODUCTION_ROUTES` = the declared production set.

- [ ] **Step 1: Clauses (RED)**

```js
    Test.it("STUDIO-13 modes has no default: an undeclared route is dev-only, and the production set is exactly what is declared", () => {
        assert.deepEqual(modesFor("/_studio/nonexistent"), ["dev"], "undeclared is dev-only — forgetting is safe")
        assert.deepEqual(modesFor("/_studio/model"), ["dev"], "schema writes stay dev-only (spec §1)")
        assert.deepEqual(modesFor("/_studio/config"), ["dev"], "config writes stay dev-only")
        for (const path of PRODUCTION_ROUTES) assert.truthy(modesFor(path).includes("production"))
        // the accessFor contract is unchanged by the new axis
        assert.equal(accessFor("/_studio/nonexistent"), "admin")
        assert.equal(accessFor("/_studio/session"), "any")
    })
```

- [ ] **Step 2: RED** — `npm test`: STUDIO-13 fails (`modesFor` missing). STUDIO-10/11/12 green.
- [ ] **Step 3: Implement** — rewrite the table with the second axis, keeping the existing docstring and adding the `modes` rule to it:

```js
export const STUDIO_ACCESS = Object.freeze({
    // "modes" has NO DEFAULT: an entry that omits it is dev-only. Opening a
    // route to production is one deliberate line here, and the invariant
    // clause asserts production answers exactly the declared set (issue #10).
    "/_studio/session": Object.freeze({ roles: "any", modes: ["dev"] }),   // moves to /api/v1/_session in Task 2
    "/_studio/model": Object.freeze({ roles: "admin", modes: ["dev"] }),
    "/_studio/entities": Object.freeze({ roles: "admin", modes: ["dev"] }),
    "/_studio/entity-delete": Object.freeze({ roles: "admin", modes: ["dev"] }),
    "/_studio/policies": Object.freeze({ roles: "admin", modes: ["dev"] }), // baseline read moves in Task 3
    "/_studio/users": Object.freeze({ roles: "admin", modes: ["dev"] }),
    "/_studio/ai": Object.freeze({ roles: "admin", modes: ["dev"] }),
    "/_studio/config": Object.freeze({ roles: "admin", modes: ["dev"] })
})

export const STUDIO_ROUTE_PATHS = Object.freeze(Object.keys(STUDIO_ACCESS))
export const accessFor = (pathname) => STUDIO_ACCESS[pathname]?.roles ?? "admin"
export const modesFor = (pathname) => STUDIO_ACCESS[pathname]?.modes ?? ["dev"]
export const PRODUCTION_ROUTES = Object.freeze(STUDIO_ROUTE_PATHS.filter((p) => modesFor(p).includes("production")))
```

`dev.js`'s gate calls `accessFor` — unchanged by this shape. Verify STUDIO-10's dev.js-source-derived check still passes (it reads `STUDIO_ACCESS` keys; keys are unchanged).

- [ ] **Step 4: GREEN** — `npm test`, 0 red.
- [ ] **Step 5: Commit**

```bash
git add src/cli/dev-access.js test/http/studio.test.js
git commit -m "Studio access gains a modes axis — undeclared means dev-only (STUDIO-13)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: `/api/v1/_session` — one login contract for both modes

**Files:** Modify `src/core/HTTP/api.js`, `src/cli/commands/dev.js`, `src/studio/kit/api.js` · Test `test/http/start.test.js`, `test/http/studio.test.js`

**Interfaces:** `GET /api/v1/_session` → `{ ok, data: { authRequired, user, roles } }`. Anonymous callers get `{ authRequired, user: null, roles: [] }` and nothing else. Roles come from the live directory (`authState.rolesForPub`), never token claims. Available in BOTH modes. `/_studio/session` is deleted; `kit/api.js`'s `session()` points at the new path.

- [ ] **Step 1: Clauses (RED)**

In `test/http/start.test.js` (production instance, auth on):

```js
    Test.it("START-SESSION production serves /api/v1/_session; anonymous gets the minimum, a member gets live roles", async () => {
        const anon = await fetch(base + "/api/v1/_session")
        assert.equal(anon.status, 200)
        const a = (await anon.json()).data
        assert.equal(a.user, null)
        assert.deepEqual(a.roles, [])
        assert.equal(typeof a.authRequired, "boolean")
        const mine = (await withToken(adminToken, "GET", "/api/v1/_session")).body.data
        assert.deepEqual(mine.roles, ["admin"])
        // and the dev-only path is gone from production
        assert.equal((await fetch(base + "/_studio/session")).status, 404)
    })
```

In `test/http/studio.test.js`: assert `/_studio/session` now 404s in dev too (it moved, it did not fork).

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement**

`api.js` — beside the existing `_events` branch, before the generic entity routing:

```js
            // Session (whoami). Lives in the versioned API so the login UI has
            // ONE contract in both modes (issue #10). Anonymous is legal and
            // returns the minimum: whether auth is on, and nothing else.
            if (segments[0] === "_session" && req.method === "GET") {
                const token = url.searchParams.get("token")
                if (token && !req.headers["authorization"]) req.headers["authorization"] = "Bearer " + token
                let user = null
                let roles = []
                try {
                    const ctx = context(req)
                    user = ctx.user ?? null
                    roles = ctx.roles ?? []
                } catch { /* anonymous — E_AUTH is a legal answer here */ }
                return ok(res, { authRequired: authRequired(), user, roles }), true
            }
```

`createApi` gains an `authRequired` accessor (a function, so it stays live) alongside `events`; `buildInstanceApi` passes `() => authState.required`. Read how `events` was threaded in the realtime work and mirror it exactly.

Note the anonymous case: `context(req)` throws `E_AUTH` when auth is required and no credential is present — catching it and answering `{ user: null }` is the intended behavior, not swallowing an error. Comment it so nobody "fixes" it later.

Delete `/_studio/session` from `dev.js` and its entry from `STUDIO_ACCESS`. Point `kit/api.js`'s `session()` at `/api/v1/_session`.

- [ ] **Step 4: GREEN** — `npm test`: STUDIO-09/09a/11 (which exercised `/_studio/session`) must be updated to the new path — they were pinning behavior that moved, not behavior that died; say so in the report.
- [ ] **Step 5: Commit**

```bash
git add src/core/HTTP/api.js src/core/HTTP/server.js src/cli/commands/dev.js src/cli/dev-access.js src/studio/kit/api.js test/http
git commit -m "Session moves to /api/v1/_session — one login contract in both modes (START-SESSION)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: `/api/v1/_policy-layers` — the read-only baseline view

**Files:** Modify `src/core/HTTP/api.js`, `src/core/HTTP/server.js`, `src/cli/commands/dev.js`, `src/studio/routes/permissions/index.js` · Test `test/http/policy-window.test.js`

**Interfaces:** `GET /api/v1/_policy-layers` → the same `{ layers: [{ source, readonly, policies }] }` shape `/_studio/policies` returned, built from the engine's live arrays via `policyLayers()`. **Admin-only through the ordinary policy engine** — not a bespoke gate: require `read` on `nexus_policy` (which only the admin bundle grants), so authorization is one mechanism, not two. `/_studio/policies` is deleted.

- [ ] **Step 1: Clauses (RED)** — in the existing auth-on suite:

```js
    Test.it("POLWIN-03 the layer view is a normal API route: admin sees the layers, a viewer is refused", async () => {
        const asAdmin = await call(ADMIN, "GET", "/api/v1/_policy-layers")
        assert.equal(asAdmin.body.ok, true)
        const sources = asAdmin.body.data.layers.map((l) => l.source)
        assert.truthy(sources.includes("system") && sources.includes("admin") && sources.includes("rows"))
        const asViewer = await call(VIEWER, "GET", "/api/v1/_policy-layers")
        assert.equal(asViewer.body.ok, false)
        assert.equal(asViewer.body.error.code, "E_FORBIDDEN")
    })
```

Plus, in the production suite: the route answers under `nexus start` (it is the thing the permissions page needs there).

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement**

`api.js`, beside `_session`:

```js
            // The policy WINDOW as a normal API route (issue #10): same layers
            // the engine composes, authorized by the SAME policy engine as
            // everything else — `read` on nexus_policy, which only the admin
            // bundle grants. No bespoke gate.
            if (segments[0] === "_policy-layers" && req.method === "GET") {
                if (!layers) throw new Error("E_NOT_FOUND: no policy layers on this instance")
                const ctx = context(req)
                await plane.list("nexus_policy", { limit: 1 }, ctx)   // authorization, by the engine
                return ok(res, layers()), true
            }
```

The `plane.list` call is the authorization step — it throws `E_FORBIDDEN` for a non-admin exactly as any other read would. Comment that this is deliberate: it borrows the engine's decision rather than re-deriving one.

`createApi` gains `layers` (the shaping function); `buildInstanceApi` passes a function that builds the `{ layers: [...] }` document from `policyLayers()` — **move the grouping logic out of `dev.js` into `server.js`** so both modes share one implementation and dev.js keeps no copy.

Delete `/_studio/policies` from dev.js and `STUDIO_ACCESS`. Point `src/studio/routes/permissions/index.js` at `ctx.api.get("/api/v1/_policy-layers")`.

- [ ] **Step 4: GREEN** — `npm test`: existing STUDIO-06/08 clauses referencing `/_studio/policies` update to the new route or drop (say which and why).
- [ ] **Step 5: Commit**

```bash
git add src/core/HTTP/api.js src/core/HTTP/server.js src/cli/commands/dev.js src/cli/dev-access.js src/studio/routes/permissions test/http
git commit -m "Policy layers become an ordinary authorized API route (POLWIN-03)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: The roles page stops calling a route deleted months ago

**Files:** Modify `src/studio/routes/roles/index.js` · Test: none (UI; `node --check` + suite green)

`src/studio/routes/roles/index.js:31` calls `ctx.api.studio("permissions", "GET")` — a route deleted in the permissions-on-rows work, which now 404s by design. So `baselines.ok` is always false, `grantingBase` is always `[]`, and the page **silently under-reports which roles are granted by shipped baselines**. No error, just wrong numbers.

- [ ] **Step 1: Fix** — point it at `/api/v1/_policy-layers` (Task 3) and take the read-only layers' policies as the baseline set, mirroring how `permissions/index.js` consumes the same document. Read both files and keep their shapes consistent.
- [ ] **Step 2: Verify** — `node --check` the file; `npm test` green; manually confirm the roles page's counts change from "always zero baseline grants" to real numbers (browser pass, joins the E2E debt).
- [ ] **Step 3: Commit**

```bash
git add src/studio/routes/roles/index.js
git commit -m "Roles page reads the live policy layers — it had been calling a deleted route and silently reporting zero

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: `nexus studio build` — the Studio as static assets

**Files:** Create `src/cli/commands/studio.js`, modify `src/cli/main.js` (command registration) · Test `test/cli/studio-build.test.js` (register in `test.js`)

**Interfaces produced:** `nexus studio build [--out public/studio]` — walks `src/studio/app.js`'s import graph, copies every reached file under the nexus package into `<out>/`, rewriting `/_nexus/src/...` specifiers to paths relative to the output root; writes `<out>/index.html` (the shell, with no dev bootstrap). Exports `collectModules(entryUrl) → string[]` (pure-ish, testable) and `buildStudio({ root, out })`.

- [ ] **Step 1: Clauses (RED)**

```js
    Test.it("STB-01 collectModules follows the import graph and stays inside the package", () => {
        const files = collectModules(new URL("../../src/studio/app.js", import.meta.url))
        assert.truthy(files.some((f) => f.endsWith("src/studio/app.js")))
        assert.truthy(files.some((f) => f.includes("src/studio/components/")))
        assert.truthy(files.some((f) => f.includes("src/core/")), "kernel modules the Studio imports come along")
        for (const f of files) assert.truthy(f.includes("/src/") || f.includes("/vendor/"), `${f} is inside the package`)
        assert.equal(files.some((f) => f.includes("/cli/") || f.includes("/HTTP/")), false, "server-side code never ships to a browser")
    })

    Test.it("STB-02 the built tree resolves: every specifier points at a file that exists in the output", async () => {
        const out = mkdtempSync(join(tmpdir(), "nexus-studio-"))
        await buildStudio({ root: NEXUS_ROOT, out })
        assert.truthy(existsSync(join(out, "index.html")))
        // walk every .js in the output and resolve each relative specifier
        for (const file of walkJs(out)) {
            for (const spec of specifiersIn(readFileSync(file, "utf8"))) {
                if (!spec.startsWith(".")) continue
                assert.truthy(existsSync(resolve(dirname(file), spec)), `${file} → ${spec}`)
            }
        }
        assert.equal(readFileSync(join(out, "index.html"), "utf8").includes("_dev"), false, "no dev bootstrap in a built shell")
        rmSync(out, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
    })
```

Write `walkJs`/`specifiersIn` as small local helpers in the test (a regex over `from "..."` / `import("...")` is sufficient — say so in a comment; this is a build check, not a parser).

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement `src/cli/commands/studio.js`**

The walk: start at `app.js`, read each file, extract static `from "…"` and dynamic `import("…")` specifiers, resolve them (relative → path; `/_nexus/src/…` → package-root-relative), recurse, and stop at anything outside the package. Copy each reached file preserving its path under the package (so relative specifiers keep working unchanged), and rewrite only the `/_nexus/`-absolute ones to relative.

`index.html` comes from `studioIndex(...)` with the dev bootstrap omitted, and its script/link tags rewritten to the output-relative paths. Read `src/studio/layouts/studio/shell.js` first — if `studioIndex` hardcodes `/_nexus/...` URLs, the build rewrites those strings; if it takes a base, pass one.

The `nexus studio` command surface: `build` is the only subcommand in v1; anything else is `E_USAGE` listing it.

- [ ] **Step 4: GREEN** — `npm test`, 0 red.
- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/studio.js src/cli/main.js test/cli/studio-build.test.js test.js
git commit -m "nexus studio build: the Studio ships as static assets, no framework-source route needed (STB-01/02)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: `nexus start` serves the built Studio

**Files:** Modify `src/cli/commands/start.js` · Test `test/http/start.test.js`

**Interfaces:** when `<root>/public/studio/index.html` exists, `start.js` serves `index.html` for paths matching the Studio's route table and serves `public/studio/*` assets through the existing static boundary. When it does not exist, nothing changes (404).

- [ ] **Step 1: Clauses (RED)**

```js
    Test.it("START-STUDIO with a built Studio, production serves the shell for Studio routes and its assets", async () => {
        // build into the scratch instance first: `nexus studio build --out <root>/public/studio`
        assert.equal((await fetch(base + "/users")).status, 200)          // a Studio route → the shell
        assert.truthy((await (await fetch(base + "/users")).text()).includes("<nx-"))
        assert.equal((await fetch(base + "/public/studio/app.js")).status, 200) // assets
        assert.equal((await fetch(base + "/_nexus/src/core/UI.js")).status, 404) // never framework source
        assert.equal((await fetch(base + "/nope.js")).status, 404)        // file-looking paths never reach the shell
    })

    Test.it("START-STUDIO-ABSENT without a build, production has no Studio and says so with a 404", async () => {
        assert.equal((await fetch(base2 + "/users")).status, 404)
    })
```

- [ ] **Step 2: RED.**
- [ ] **Step 3: Implement** — mirror dev.js's `routeMatches` discipline (a path only reaches the shell if it precisely matches a known Studio route; file-looking paths and dotpaths never do). Serve assets through the same resolve-then-`startsWith` boundary `start.js` already uses for `public/`. Do NOT add a new static root — `public/studio/` is already inside `public/`.
- [ ] **Step 4: GREEN** — `npm test`: START-03's 404 assertions for `/_nexus/*` and `/__dev_events` must still pass.
- [ ] **Step 5: Commit**

```bash
git add src/cli/commands/start.js test/http/start.test.js
git commit -m "nexus start serves the built Studio when one exists, and nothing new when it does not (START-STUDIO)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: The nav hides what production does not have

**Files:** Modify `src/studio/app.js`, `src/studio/layouts/studio/shell.js` · Test: none (UI)

The boot payload gains `mode: "dev" | "production"` (the servers already build that payload — dev.js passes it to `studioIndex`; the built shell hardcodes `"production"`). `app.js`'s MODULES entries gain a `devOnly: true` flag for the schema designer (`/entities`) and the two config panels (`/settings` general, `/settings/ai`); the nav and the route table filter them out when `mode === "production"`.

A production user navigating directly to a dev-only route gets the Studio's normal not-found handling, not a broken page.

- [ ] **Step 1: Implement** per above; read `app.js`'s MODULES/BUILD shape first and follow it.
- [ ] **Step 2: Verify** — `node --check` both files; `npm test` green; browser pass (dev shows everything, a built shell hides the three).
- [ ] **Step 3: Commit**

```bash
git add src/studio/app.js src/studio/layouts/studio/shell.js
git commit -m "Studio nav derives from the mode: dev-only surfaces do not exist in a production build

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: The structural invariants

**Files:** Test `test/http/start.test.js` (or a new `test/cli/production-surface.test.js`, registered in `test.js`)

Two clauses that make the boundary structural rather than remembered.

- [ ] **Step 1: Clauses**

```js
    Test.it("PROD-01 start.js never imports the dev module — the dev-only surface is unreachable, not merely unmounted", () => {
        // walk start.js's static import graph; dev.js (and anything only it reaches) must not appear
        const reached = collectModules(new URL("../../src/cli/commands/start.js", import.meta.url))
        assert.equal(reached.some((f) => f.endsWith("commands/dev.js")), false)
        assert.equal(reached.some((f) => f.includes("HMR")), false, "no hot-reload machinery in production")
    })

    Test.it("PROD-02 production answers exactly the declared production route set", async () => {
        for (const path of STUDIO_ROUTE_PATHS) {
            const status = (await fetch(base + path)).status
            const declared = modesFor(path).includes("production")
            assert.equal(status !== 404, declared, `${path}: served=${status !== 404} declared=${declared}`)
        }
    })
```

Reuse `collectModules` from Task 5 (export it) rather than writing a second walker.

- [ ] **Step 2: Verify they discriminate** — temporarily add a `production` mode to a dev-only entry and confirm PROD-02 goes RED; temporarily import dev.js from start.js and confirm PROD-01 goes RED. Restore both. Report the evidence.
- [ ] **Step 3: Commit**

```bash
git add test
git commit -m "Structural invariants: production cannot reach the dev module, and answers exactly what is declared (PROD-01/02)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: STATUS + the README overclaim

**Files:** Modify `STATUS.md`, `README.md`

- [ ] **Step 1: STATUS** — add a row: the Studio's data plane runs in production (`nexus studio build` → `public/studio/`, served through the existing static boundary; `/api/v1/_session` and `/api/v1/_policy-layers`; nav derived from mode), clauses `STUDIO-13, START-SESSION, POLWIN-03, STB-01/02, START-STUDIO*, PROD-01/02`. Honest bullets: schema editing and config writing are **not** in production (and why — hot-reload-under-load and non-transactional entity delete, issue #9 I8); no bundling/minification; the browser render pass is manual.
- [ ] **Step 2: README** — `README.md:48`'s comparison row *"Schema changes in production: ✅ hybrid: additive = instant"* is **not true of shipped code**. Correct it to describe what runs: schema changes are a dev-and-deploy activity today; the hybrid additive/structural design is stated as the design contract it is. The footnote at `README.md:61` already reserves that distinction — make the row consistent with it rather than leaning on the footnote.
- [ ] **Step 3: Full suite + real flow** — `npm test` (expect 566 + ~10, 0 red). Then by hand: `nexus create`, `nexus studio build`, `nexus start --insecure` with an admin identity → log in through the built Studio, load `/users` and `/permissions`, confirm `/entities` is absent from the nav and `/_nexus/src/core/UI.js` 404s. Paste the observed output.
- [ ] **Step 4: Commit**

```bash
git add STATUS.md README.md
git commit -m "STATUS + README: the Studio runs in production, and the schema-changes row now describes what ships

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
