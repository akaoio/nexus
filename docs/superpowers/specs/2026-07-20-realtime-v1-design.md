# Realtime v1 — design

**Date:** 2026-07-20
**Problem:** Nexus has no realtime. Clients (and the Studio itself) poll or
refresh by hand; the reality-review named live queries the one capability
every 2026 headless backend is assumed to have. Separately, the dev loop is
cold: the akao HMR runtime ships in the kernel (`core/HMR.js`,
`core/HMR/client.js`) but nothing server-side feeds it — schema edits and
code edits both end in a manual F5 (a STATUS debt).

**Decision:** one SSE infrastructure, two deliberately separate streams:
a public, auth'd, permission-faithful DATA stream in the versioned API, and
a dev-only TOOLING stream on the exact contract the akao HMR client already
expects. Permission never leaves the plane: an event reaches a subscriber
only if that subscriber can re-read the row through the Data Plane.

## 1. The public data stream — `GET /api/v1/_events`

Lives in `core/HTTP/api.js` (every mode, dev and production). The `_`
namespace can never collide with an entity (same rule as extension
endpoints).

- **Auth:** the same `context(req)` every endpoint uses. Because
  `EventSource` cannot set an `Authorization` header, THIS endpoint also
  accepts the bearer token as `?token=` (documented: this is the one
  query-param token in the API; production runs TLS-required, and access
  logs are the operator's own).
- **Subscription:** `?entities=a,b` filters; without it, every entity
  EXCEPT `nexus_job` (whose lifecycle churn — claim/settle per tick — would
  spam; the Studio /jobs page opts in explicitly).
- **Source:** `after:create/update/remove` hooks registered for every
  loaded entity at server build (the same seam the effect app's webhook
  emitter uses). The hook body only enqueues an in-memory broadcast — it
  must never throw into the write path (same guard doctrine as WH-03).
- **Permission — the heart of the design:** for each event and each
  subscriber, the server re-reads the row through the plane under THAT
  subscriber's ctx (`plane.get(entity, id, subscriberCtx)`); only a
  successful read emits. Enforcement stays 100% in the Data Plane — row
  rules, permlevel, ifOwner all apply for free, and a denied subscriber
  learns nothing, not even the id's existence. For `after:remove` the row
  is gone, so the check is doc-level instead:
  `Permission.resolve(subscriberCtx.policies, { entity, action: "read", … })`
  — an unavoidable, documented asymmetry, and it is WIDER than "a row the
  subscriber could have read moments earlier": `Permission.resolve` returns
  `{allowed:true, filter}` whenever any permlevel-0 policy applies; the
  row-restricting `rule`/`ifOwner` survive only in `filter`, which this
  doc-level check discards. So any subscriber with document-level read on an
  entity learns the id of ANY removed row of that entity, irrespective of
  row-level restrictions. A `before:remove` hook capturing the row (so the
  check could re-apply `filter` against the pre-deletion row) would close
  the asymmetry entirely — v2 note.
- **Wire format:** standard SSE. Each event:
  `data: { "entity", "event": "create"|"update"|"remove", "id", "ts" }`.
  No row data ever rides the stream — subscribers refetch through the
  ordinary API (which enforces field-level permission on its own). A
  heartbeat comment (`:hb`) every 30 s keeps proxies from killing idle
  connections.
- **Reconnect:** none of the replay machinery — v1 is honest: no
  `Last-Event-ID`, no backlog. A client that reconnects refetches its
  lists. (Replay/backlog is v2, and would ride the effect engine's job
  table if ever needed.)
- **Backpressure:** if `res.write` returns false or throws, the subscriber
  is closed and dropped. Slow clients lose events, not the server.

## 2. Studio consumption — dogfooding the public stream

- `src/studio/kit/events.js`: `subscribe(entities, onEvent) → unsubscribe`
  — wraps `EventSource` on `/api/v1/_events`, appends the session token as
  `?token=` when auth is on, auto-reconnects (the browser's native SSE
  retry), dedupes by `entity:id:ts`.
- List-bearing routes refresh on matching events: the entity list route,
  `/jobs` (subscribes `nexus_job` explicitly), `/users`, `/roles`,
  `/permissions` (rows layer). v1 refresh = re-run the route's existing
  `load()` (coarse but truthful); row-level patching is v2 polish.
- The Studio uses ONLY the public surface — §361 again: if the Studio can
  live-refresh with it, any client can.

## 3. The dev tooling stream — `/__dev_events` (dev-only)

The path, message contract, and client behavior ALREADY exist in
`core/HMR/client.js` — this spec wires the missing server half and never
invents a second contract.

- **Endpoint:** SSE at `/__dev_events`, served by dev.js only (`nexus
  start` never mounts it). Unauthenticated by design: local dev tooling,
  same trust level as the rest of the dev-mode surface.
- **Watcher:** `fs.watch` (recursive) over the directories dev serves to
  the browser — `src/studio/`, `src/core/` (the kernel files the Studio
  imports), and `apps/<dir>/` — debounced ~80 ms per path. Ignores
  non-`.js`/`.css`/`.yaml` files and dotfiles.
- **Message mapping — one contract wrinkle, resolved here:** the shipped
  client gates on `update.type === "hmr"` (client.js:63) and then hands the
  SAME object to `HMR.js.apply`, which destructures `{ path, type,
  timestamp }` and reads `type` as the ASSET kind (css|template|js) — the
  message-kind field and the asset-kind field collide in the existing
  contract. Pinned resolution: the server sends
  `{ "type": "hmr", "path": "…", "asset": "css"|"template"|"js",
  "timestamp": ms }`, and `HMR.js.apply` is amended to read
  `update.asset ?? update.type`. This is backward-compatible: apply's
  existing path-suffix fallbacks (`path.endsWith(".css.js")`,
  `path.includes("/template.js")`) already make the asset field
  effectively optional.
- **Full module swap** (the chosen v1 depth): plain `.js` changes ride
  `swapmod` — HMR.js's re-import + registry + import-map versioning as
  built. Where a swap cannot apply (module not in the registry, error
  during re-import), HMR.js already logs and the server can do no better —
  the developer's escape hatch is F5, and the `"reload"` message covers
  the structural cases below.
- **Schema hot-reload:** when the dev server's entity hot-reload runs
  (`/_studio/model` writes, entity delete), broadcast `"reload"` (the
  legacy full-page message client.js already honors) — closing the "F5
  after schema change" STATUS debt.
- **Bootstrap:** dev.js injects into the served Studio HTML a small inline
  script setting `globalThis._dev = { enabled: true, runtime:
  "/_nexus/src/core/HMR.js" }` plus a `<script src>` for
  `/_nexus/src/core/HMR/client.js` (both already served by the dev static
  route). Production HTML never contains either.

## 4. Error handling

- Hook broadcast bodies are try/caught (WH-03 doctrine): a realtime
  failure never fails the primary write.
- A subscriber whose permission re-read throws (not just denies) is
  skipped for that event with a server-side warn — one bad evaluation must
  not drop the connection.
- Watcher errors warn and disable the watcher (dev keeps running without
  HMR rather than crashing).
- Both streams handle client disconnect (`close`/`error` on req/res) by
  reaping the subscriber; the connection sets kept in plain Sets/Maps.

## 5. Testing (spec-first, clauses RED before code)

- **EVT-01:** real dev server; a raw `fetch` SSE consumer subscribes to
  `?entities=task`; a `task` create through `/api/v1` delivers exactly
  `{ entity, event: "create", id, ts }`; an update delivers `update`; the
  payload carries no row fields.
- **EVT-02 (the permission clause):** POLWIN-style auth-on instance (two
  API keys): the viewer subscribes; a write to an entity the viewer cannot
  read produces NO event on its stream (bounded negative window), while an
  admin subscriber receives it; a write to a viewer-readable entity
  reaches both.
- **EVT-03:** default subscription excludes `nexus_job`; `?entities=nexus_job`
  opts in (enqueue one job through the fixture endpoint, observe its
  lifecycle events arrive).
- **EVT-04:** heartbeat arrives on an idle stream; a dropped consumer is
  reaped (subscriber count via a dev-only introspection or asserted
  indirectly by the server staying healthy after abrupt disconnects).
- **HMR-01 (pure):** the path→asset mapping function (`.css.js` → css,
  `/template.js` → template, `.js` → js, ignores others) and the debounce
  behavior, as an exported pure seam in the watcher module.
- **HMR-02:** dev server broadcasts `"reload"` on a `/_studio/model` write
  (SSE consumer on `/__dev_events` observes it); `nexus start` does NOT
  mount `/__dev_events` (404/absent — clause).
- The full in-browser swap loop (CSS/template/module) joins the manual
  browser pass — `fs.watch` timing through CDP is not suite-worthy; the
  mapping and transport are what the clauses pin.

## Out of scope (v1)

- Event replay / `Last-Event-ID` backlog (v2; would ride the job table).
- Row-level list patching in the Studio (v1 re-runs `load()`).
- WebSocket transport (Node has no native WS server; SSE is native HTTP
  and the shipped HMR client is already SSE).
- Watching for `nexus.config.json` changes (restart remains the contract).
- HMR for Node-side code (server restart remains the dev contract; only
  browser-served files hot-swap).
