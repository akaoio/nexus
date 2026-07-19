# Effect engine v1 — design

**Date:** 2026-07-19
**Problem:** Nexus has no effect layer. Six of the product gaps the external
reality-review identified (workflow, media, email, webhook, realtime, durable
jobs) reduce to one missing capability: coordinated side-effects — "exactly
one worker does it, done is acked, failure retries, poison is quarantined".
CRDT sync replicates STATE; it cannot coordinate EFFECTS (a re-played "send
email" sends twice). `C:\Users\x\Projects\social` proved the need in
production by hand-rolling every primitive (submission lease before
irreversible calls, dedup ledgers, fail-closed quotas, pacing) —
`social/docs/architecture.md` is the requirements record for this spec.

**Decision:** jobs become ordinary system entities driven by a small core
runner; handlers execute in Threads (the akao Launcher discipline); the three
first consumers (webhook, mail, notification) ship as an "effect app" written
ONLY against the public App API. ARCHITECTURE §12.7's deferred `jobs`
extension point lands here.

## 1. Three new system entities

Declared in `src/core/App/system.js` beside user/role/policy/view — ordinary
Model Schema v1 documents on the same pipeline; `isSystem` and the shipped
admin baselines extend to them. Rows are data; Studio and `/api/v1` come for
free.

- **`nexus_job`**: `name` (text, required — the handler key), `payload`
  (text JSON), `status` (select `pending|running|done|failed|dead`, default
  `pending`), `run_at` (datetime, default now), `every_ms` (integer, null =
  one-shot), `attempts` (integer, default 0), `max_attempts` (integer,
  default 5), `lease_until` (datetime, null), `last_error` (text),
  `result` (text JSON).
- **`nexus_webhook`**: `url` (text, required), `entity` (text, null = every
  entity), `events` (text JSON — subset of `after:create`, `after:update`,
  `after:remove`), `secret` (text — HMAC key), `enabled` (boolean, default
  true), `description` (text).
- **`nexus_notification`**: `user` (text pub, required), `title` (text,
  required), `body` (text), `href` (text), `read` (boolean, default false).

## 2. The core engine — only what cannot live above (N5)

A runner loop on the MAIN thread of the serving process (`nexus start` and
`nexus dev`), ticking every `jobs.poll_ms` (config, default 1000).

- **Claim is an adapter-level atomic primitive** — the one spec-pinned
  invariant multi-worker futures must keep:
  `UPDATE … SET status='running', lease_until=now+lease_ms, attempts=attempts+1
  WHERE status IN ('pending','failed') AND run_at <= now AND
  (lease_until IS NULL OR lease_until < now)` (with `RETURNING`/re-read;
  one row per claim). Two concurrent claims of the same row: exactly one
  wins — clause-pinned.
- Every OTHER transition (ack → `done`, handler error → `failed` +
  backoff, exhausted → `dead`, recurring reschedule) is an ordinary
  `plane.update`, so hooks and any audit see job lifecycle like any data.
- **Retry:** exponential backoff `next run_at = now + min(cap, base·2^attempts)`
  with `base = 5000 ms`, `cap = 300000 ms` (engine constants, clause-pinned).
  `attempts > max_attempts` → `status='dead'` (the DLQ — visible, retryable).
- **Recurring:** on ack of a row with `every_ms`, the SAME row returns to
  `pending` with `run_at = now + every_ms`, `attempts = 0` (table does not
  grow; one-shot rows keep their history and are deletable via the API).
- **Time is injectable** (a `now()` seam) — the conformance suite never
  waits on a wall clock.

## 3. Execution in Threads (the Launcher discipline)

Handlers never run on the main thread.

- A job thread BOOTSTRAPS by loading the apps' `hooks.js` itself, with a
  thread-side registrar that collects ONLY `job()` registrations — handler
  code lives in the thread; functions are never serialized over messages.
- Main thread dispatches `{ jobId, name, payload }`; the thread answers
  `{ ok, result }` or `{ ok: false, error }` over the existing Thread.js
  message protocol.
- **Narrow plane-RPC:** the thread may call exactly four ops —
  `create/update/get/list` — which the main thread executes under a
  job-scoped context with its own permission policies (spec'd per
  consumer; never god-mode). No other core surface crosses the message
  boundary.
- Thread pool size = `jobs.threads` (config, default 1). A thread crash or
  timeout leaves the row `running` until `lease_until` passes; the claim
  primitive then makes it retryable — crash recovery needs no extra
  machinery.

## 4. App API v1 additions (§8.3)

- Registrar gains `job(name, { run, maxAttempts })` — names namespaced by
  convention `<app>.<verb>` (collision = load error, like endpoints).
- Hook/endpoint contexts gain `enqueue(name, payload, { runAt, everyMs,
  maxAttempts })` — sugar over `plane.create("nexus_job", …)`.
- Both are versioned contract additions: names and shapes freeze on ship
  (N3).

## 5. The effect app — three consumers on the PUBLIC App API only

Ships with nexus but is architecturally an app (`hooks.js`-style module
loaded through the same `loadExtensions` path, after user apps). Doctrine
§361 applied twice: if the effect app can build webhooks with public
surface, a third-party app can build any effect.

- **Webhook:** at load, registers `after:create/update/remove` hooks for
  every loaded schema; on fire, if any enabled `nexus_webhook` row matches
  (entity + event), enqueues `effects.webhook` with `{ webhookId, entity,
  event, id }`. The handler (in-thread) POSTs JSON `{ entity, event, id,
  ts, delivery }` with headers `X-Nexus-Signature` (HMAC-SHA256 of the
  body with the row's `secret`) and `X-Nexus-Delivery` (jobId + attempt —
  receivers dedup on it). Non-2xx or network error → throw → retry →
  DLQ.
- **Notification:** `enqueue("effects.notify", { user, title, body, href })`;
  the handler creates the `nexus_notification` row through plane-RPC.
  (Async-with-retry is the point of routing a row-create through a job.)
- **Mail:** core defines the provider seam — `sendMail({ to, subject,
  text, html }) → { id }` — resolved from `config.mail.provider`:
  - `"log"` (default, zero-dep): writes the mail to the server log — dev
    and CI never need SMTP.
  - `"smtp"`: backed by nodemailer resolved from the INSTANCE's
    node_modules (`createRequire` from the instance root — the
    transformers.js/N2 pattern; the kernel gains no dependency).
  `enqueue("effects.mail", { to, subject, text, html })`; the handler loads
  the provider in-thread and sends. Config `mail.*` is redacted by the
  existing `/_studio/config` redaction.

## 6. The local-first boundary (the honest line)

- `nexus_job` and `nexus_webhook` are **server-mode entities: excluded
  from the ZEN sync set**. Replication ≠ work distribution — a job row
  replayed on every peer is an effect executed N times. This is
  "server optional for state, REQUIRED for effects" made code.
- `nexus_notification` is ordinary data (it may sync like any row).
- **Delivery semantics: at-least-once.** A crash after an irreversible
  external call and before the ack retries the job — the effect can
  repeat (the social lesson: their answer is lease + fail-closed recheck,
  which is domain-specific). Webhook receivers dedup via
  `X-Nexus-Delivery`; mail accepts documented double-send risk. Exactly-
  once is a lie no queue tells truthfully; the spec does not tell it
  either.

## 7. Error handling

- Unparseable `payload` at claim time → straight to `dead` with
  `last_error = "E_PAYLOAD"` — fail-loud (a lost job is lost work; unlike
  a corrupt policy row, silent skip would hide it). Visible in the DLQ.
- Handler throw → `failed`, `last_error` = message, backoff reschedule.
- Unknown `name` (no registered handler) → `dead` with `E_HANDLER`.
- Thread death/timeout → lease expiry → re-claim (bounded by
  `max_attempts` like any failure).
- Studio `/jobs`: list view over `nexus_job` grouped by status, a Retry
  action (ordinary entity-API update: `status='pending'`, `attempts=0`,
  `lease_until=null`), the DLQ front and center. No new mechanism — a
  route over the existing API, like `/users`.

## 8. Testing (spec-first, clauses RED before code)

- **JOB-*:** claim atomicity (two claims, one winner — real engine);
  backoff schedule against the injectable clock; DLQ transition at
  `max_attempts`; recurring reschedule resets attempts; unknown handler →
  `E_HANDLER` dead; unparseable payload → `E_PAYLOAD` dead.
- **THR-*:** a fixture app registers a real `job()`; the handler executes
  in a REAL thread and returns a result; plane-RPC allows the four ops
  under the job ctx and refuses anything else.
- **WH-*:** a real local HTTP receiver in the test: payload shape,
  HMAC-SHA256 signature verifies, `X-Nexus-Delivery` present; a 500
  receiver → retry → DLQ after exhaustion.
- **MAIL-*:** the `"log"` provider (no network); provider resolution from
  config; missing nodemailer for `"smtp"` → clear `E_PROVIDER` (the
  transformers pattern's error).
- **NOTIF-*:** enqueue → row lands for the right user.
- **SYNC boundary:** `nexus_job`/`nexus_webhook` are not in the sync
  entity set (clause asserts the exclusion list).
- Studio `/jobs` page joins the manual browser pass (existing E2E debt);
  its data path is covered by the entity-API clauses.

## Out of scope (v1)

- Cron syntax (`every_ms` covers pacing; a cron parser is v2 if demanded).
- Multi-process / multi-machine workers (claim primitive already permits
  them; two-writer SQLite is the blocker to solve then).
- CPU-bound `thread: true` per-handler placement knobs — all handlers run
  in the job thread pool in v1.
- Media/upload pipeline (separate spec; it will RIDE this engine).
- Quotas/pacing beyond `every_ms` (app-level concern; social keeps its
  domain quotas).
- In-app notification UI (bell) — rows + entity list only in v1.
