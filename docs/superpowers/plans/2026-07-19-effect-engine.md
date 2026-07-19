# Effect Engine v1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Durable jobs as system entities driven by a small core runner, handlers executing in Threads with a narrow plane-RPC, and three consumers (webhook, mail, notification) shipped as an effect app on the public App API.

**Architecture:** `nexus_job/nexus_webhook/nexus_notification` are Model Schema v1 system entities. `core/App/jobs.js` owns the claim primitive (token-CAS UPDATE, portable — no RETURNING, no same-table subselect) plus lifecycle transitions through the plane. A main-thread runner ticks, claims, and dispatches to a job worker (`core/threads/job.js`, akao Thread protocol); the worker bootstraps by loading app `hooks.js` files itself (thread-side registrar collects only `job()`), and reaches data through a **pseudo-thread "plane"** registered on the main-side Threads manager — worker→main RPC over the existing message protocol, zero kernel changes. The effect app (`core/App/effects.js`) registers webhook hooks + the three handlers using the same registrar surface apps get.

**Tech Stack:** Node ESM zero-dep kernel; repo conformance harness (`src/core/Test.js`, `npm test`); real Worker Threads in tests; nodemailer only ever as an INSTANCE dependency.

**Spec:** `docs/superpowers/specs/2026-07-19-effect-engine-design.md`

## Global Constraints

- Spec-first TDD (N6): clause families `JOB-*`, `THR-*`, `EXT-J*`, `WH-*`, `MAIL-*`, `NOTIF-*`; RED before code. Suite baseline: 498 green / 0 red / 53 skipped; must stay 0 red throughout.
- Kernel gains NO dependency (N2): nodemailer resolves from the instance root via `createRequire` (the transformers.js pattern); HMAC via `node:crypto`.
- Delivery semantics: **at-least-once**; backoff `min(300000, 5000·2^attempts)` ms; lease 60000 ms; defaults `max_attempts` 5, `jobs.poll_ms` 1000, `jobs.threads` 1.
- Time is injectable everywhere: engine functions take a `now()` (epoch ms). No test ever sleeps on a wall clock or on `poll_ms`; tests call `runnerTick` directly.
- `nexus_job`/`nexus_webhook` are server-only (excluded from any sync entity set); `nexus_notification` is ordinary data.
- Handlers run ONLY in the job thread; the worker's data access is ONLY the four RPC ops (`create/update/get/list`) under the job context — never god-mode.
- Commit style: repo sentence style; every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: Three system entities + the server-only list

**Files:**
- Modify: `src/core/App/system.js`
- Test: `test/app/system.test.js`

**Interfaces:**
- Produces: `SYSTEM_ENTITIES` grows by `JOB`, `WEBHOOK`, `NOTIFICATION` schemas named `nexus_job`, `nexus_webhook`, `nexus_notification`; `isSystem` covers them; `SYSTEM_BASELINES` admin bundle covers them (the existing `.map` over the system-entity name list); new export `SERVER_ONLY = Object.freeze(["nexus_job", "nexus_webhook"])` and `isServerOnly(name)`.

- [ ] **Step 1: Write the failing clause**

Append to `test/app/system.test.js` (extend the system.js import with `SERVER_ONLY, isServerOnly`):

```js
    Test.it("SYS-09 effect entities: nexus_job/webhook/notification are system docs; job+webhook are SERVER-ONLY (never sync)", () => {
        const names = SYSTEM_ENTITIES.map((s) => s.name)
        for (const n of ["nexus_job", "nexus_webhook", "nexus_notification"]) {
            assert.truthy(names.includes(n), n)
            assert.truthy(isSystem(n), n + " is system")
        }
        const job = SYSTEM_ENTITIES.find((s) => s.name === "nexus_job")
        const f = Object.fromEntries(job.fields.map((x) => [x.name, x]))
        assert.equal(f.name.required, true)
        assert.deepEqual(f.status.options, ["pending", "running", "done", "failed", "dead"])
        assert.equal(f.status.default, "pending")
        assert.equal(f.max_attempts.default, 5)
        for (const col of ["payload", "run_at", "every_ms", "attempts", "lease_until", "lease_token", "last_error", "result"]) assert.truthy(f[col], col)
        const wh = SYSTEM_ENTITIES.find((s) => s.name === "nexus_webhook")
        assert.equal(Object.fromEntries(wh.fields.map((x) => [x.name, x])).url.required, true)
        const notif = SYSTEM_ENTITIES.find((s) => s.name === "nexus_notification")
        assert.equal(Object.fromEntries(notif.fields.map((x) => [x.name, x])).user.required, true)
        // the honest line: replication ≠ work distribution
        assert.deepEqual([...SERVER_ONLY], ["nexus_job", "nexus_webhook"])
        assert.equal(isServerOnly("nexus_job"), true)
        assert.equal(isServerOnly("nexus_notification"), false)
        // every schema must pass the framework's own validation
        for (const s of SYSTEM_ENTITIES) assert.equal(validate(s).valid, true, s.name)
    })
```

Add `import { validate } from "../../src/core/Model.js"` if the file lacks it.

- [ ] **Step 2: Run to verify RED**

Run: `npm test` — SYS-09 RED (entities missing). Everything else green.

- [ ] **Step 3: Implement**

In `src/core/App/system.js`, after the `VIEW` declaration add (mirror the exact style of `POLICY`; labels en/vi like the neighbors):

```js
const JOB = Object.freeze({
    schemaVersion: 1,
    name: "nexus_job",
    label: { en: "Job", vi: "Tác vụ" },
    fields: [
        { name: "name", type: "text", required: true, label: { en: "Handler", vi: "Trình xử lý" } },
        { name: "payload", type: "text", label: { en: "Payload" } },
        { name: "status", type: "select", options: ["pending", "running", "done", "failed", "dead"], default: "pending", label: { en: "Status", vi: "Trạng thái" } },
        { name: "run_at", type: "date", label: { en: "Run at", vi: "Chạy lúc" } },
        { name: "every_ms", type: "integer", label: { en: "Every (ms)" } },
        { name: "attempts", type: "integer", default: 0, label: { en: "Attempts" } },
        { name: "max_attempts", type: "integer", default: 5, label: { en: "Max attempts" } },
        { name: "lease_until", type: "date", label: { en: "Lease until" } },
        { name: "lease_token", type: "text", label: { en: "Lease token" } },
        { name: "last_error", type: "text", label: { en: "Last error", vi: "Lỗi cuối" } },
        { name: "result", type: "text", label: { en: "Result", vi: "Kết quả" } }
    ]
})

const WEBHOOK = Object.freeze({
    schemaVersion: 1,
    name: "nexus_webhook",
    label: { en: "Webhook" },
    fields: [
        { name: "url", type: "text", required: true, label: { en: "URL" } },
        { name: "entity", type: "text", label: { en: "Entity", vi: "Thực thể" } },
        { name: "events", type: "text", label: { en: "Events (JSON)" } },
        { name: "secret", type: "text", label: { en: "Secret" } },
        { name: "enabled", type: "boolean", default: true, label: { en: "Enabled", vi: "Bật" } },
        { name: "description", type: "text", label: { en: "Description", vi: "Mô tả" } }
    ]
})

const NOTIFICATION = Object.freeze({
    schemaVersion: 1,
    name: "nexus_notification",
    label: { en: "Notification", vi: "Thông báo" },
    fields: [
        { name: "user", type: "text", required: true, label: { en: "User (pub)" } },
        { name: "title", type: "text", required: true, label: { en: "Title", vi: "Tiêu đề" } },
        { name: "body", type: "text", label: { en: "Body", vi: "Nội dung" } },
        { name: "href", type: "text", label: { en: "Link" } },
        { name: "read", type: "boolean", default: false, label: { en: "Read", vi: "Đã đọc" } }
    ]
})
```

Add the three to `SYSTEM_ENTITIES` (and thereby `SYSTEM_NAMES`); extend the baseline `.map` list `["nexus_user", "nexus_role", "nexus_policy", "nexus_view"]` with the three new names so the admin bundle covers them. Add:

```js
/** Effect entities never sync: replication ≠ work distribution — a job row
 *  replayed on every peer is an effect executed N times (design §6). */
export const SERVER_ONLY = Object.freeze(["nexus_job", "nexus_webhook"])
export const isServerOnly = (name) => SERVER_ONLY.includes(name)
```

Export both in the default export. Then check whether the server wires Sync: run `grep -rn "new Sync(" src/`. If any server-side site feeds live schemas into Sync, filter with `isServerOnly` there; if the only hits are tests/harness (expected today), the exported list + SYS-09 IS the deliverable and the wiring lands with server-side sync.

- [ ] **Step 4: Run to verify GREEN** — `npm test`: SYS-09 green; SYS-05 (admin bundle over every loaded entity) still green; 0 red.

- [ ] **Step 5: Commit**

```bash
git add src/core/App/system.js test/app/system.test.js
git commit -m "Effect entities: nexus_job/webhook/notification join the system registry; job+webhook are server-only (SYS-09)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: Claim primitive + lifecycle (core/App/jobs.js)

**Files:**
- Create: `src/core/App/jobs.js`
- Create: `test/app/jobs.test.js` (register it in `test.js` beside `test/app/system.test.js` — this harness has NO auto-discovery)

**Interfaces:**
- Consumes: `DataPlane` (`plane.executor.{run,all}`, `plane.create/update/get/list`), Task 1 schemas.
- Produces (later tasks consume verbatim):
  - `LEASE_MS = 60000`, `BACKOFF = { base: 5000, cap: 300000 }`
  - `backoffMs(attempts) → number` (pure: `Math.min(BACKOFF.cap, BACKOFF.base * 2 ** attempts)`)
  - `enqueue(plane, ctx, name, payload, { runAt, everyMs, maxAttempts } = {}) → row` — creates a `nexus_job` row (`payload` JSON-stringified, `run_at` = runAt ?? now ISO, `status` "pending")
  - `claimNext(plane, { now }) → { id, name, payload, attempts, max_attempts, every_ms } | null` — token-CAS claim
  - `runnerTick(plane, { now, jobs, execute, ctx, log }) → boolean` (true if a job was processed) — full lifecycle for ONE claim
- All engine writes here use a `ctx` the caller provides (the server's internal job context); tests build their own.

- [ ] **Step 1: Write the failing clauses**

Create `test/app/jobs.test.js`. Test setup: build a real in-memory plane the way `test/data/dataplane.test.js` does (read its top ~30 lines first and copy its executor/plane construction exactly — sqlite in-memory executor + `new DataPlane({ executor, schemas, now })` + `ensureTables`; schemas = `SYSTEM_ENTITIES` from system.js so `nexus_job` exists). Use a mutable `let clock = 1_000_000` and `const now = () => clock`; a permissive test ctx `const CTX = { user: "t", roles: [], shares: [], policies: [{ entity: "nexus_job", actions: ["read", "create", "write", "delete"], rule: null, permlevel: 0, ifOwner: false }] }`.

```js
    Test.it("JOB-01 enqueue lands a pending row with defaults", async () => {
        const row = await enqueue(plane, CTX, "t.echo", { x: 1 })
        assert.equal(row.status, "pending")
        assert.equal(row.max_attempts, 5)
        assert.equal(JSON.parse(row.payload).x, 1)
    })

    Test.it("JOB-02 claim: one due job, one winner — the second claim gets null", async () => {
        await enqueue(plane, CTX, "t.solo", {})
        const a = await claimNext(plane, { now })
        const b = await claimNext(plane, { now })
        assert.equal(a.name, "t.solo")
        assert.equal(b, null) // CAS: same row cannot be claimed twice inside the lease
    })

    Test.it("JOB-03 run_at gates the claim; the injectable clock releases it", async () => {
        await enqueue(plane, CTX, "t.later", {}, { runAt: new Date(clock + 60_000).toISOString() })
        assert.equal(await claimNext(plane, { now }), null)
        clock += 61_000
        assert.equal((await claimNext(plane, { now })).name, "t.later")
    })

    Test.it("JOB-04 failure → backoff schedule → dead after max_attempts (the DLQ)", async () => {
        const row = await enqueue(plane, CTX, "t.boom", {}, { maxAttempts: 2 })
        const jobs = new Map([["t.boom", {}]])
        const boom = async () => { throw new Error("kaput") }
        assert.equal(await runnerTick(plane, { now, jobs, execute: boom, ctx: CTX }), true) // attempt 1 → failed
        let r = await plane.get("nexus_job", row.id, CTX)
        assert.equal(r.status, "failed")
        assert.truthy(r.last_error.includes("kaput"))
        assert.equal(new Date(r.run_at).getTime(), clock + backoffMs(1)) // backoff pins the schedule
        clock = new Date(r.run_at).getTime() + 1
        await runnerTick(plane, { now, jobs, execute: boom, ctx: CTX }) // attempt 2 → dead
        r = await plane.get("nexus_job", row.id, CTX)
        assert.equal(r.status, "dead")
    })

    Test.it("JOB-05 success acks; every_ms reschedules the SAME row with attempts reset", async () => {
        const once = await enqueue(plane, CTX, "t.ok", {})
        const cyc = await enqueue(plane, CTX, "t.cycle", {}, { everyMs: 5000 })
        const jobs = new Map([["t.ok", {}], ["t.cycle", {}]])
        const okRun = async () => ({ ran: true })
        await runnerTick(plane, { now, jobs, execute: okRun, ctx: CTX })
        await runnerTick(plane, { now, jobs, execute: okRun, ctx: CTX })
        const one = await plane.get("nexus_job", once.id, CTX)
        assert.equal(one.status, "done")
        assert.equal(JSON.parse(one.result).ran, true)
        const cy = await plane.get("nexus_job", cyc.id, CTX)
        assert.equal(cy.status, "pending") // recurring: same row, back to pending
        assert.equal(cy.attempts, 0)
        assert.equal(new Date(cy.run_at).getTime(), clock + 5000)
    })

    Test.it("JOB-07 crash recovery: a running row with an EXPIRED lease is reclaimable; a live lease blocks", async () => {
        const row = await enqueue(plane, CTX, "t.crash", {})
        const first = await claimNext(plane, { now })
        assert.equal(first.id, row.id) // claimed → running, leased
        assert.equal(await claimNext(plane, { now }), null) // live lease blocks
        clock += 61_000 // LEASE_MS is 60000 — the thread died, the lease expired
        const again = await claimNext(plane, { now })
        assert.equal(again.id, row.id) // reclaimed, no extra machinery
        assert.equal(again.status, "running")
    })

    Test.it("JOB-06 poison fails LOUD: unknown handler → dead E_HANDLER; unparseable payload → dead E_PAYLOAD", async () => {
        const ghost = await enqueue(plane, CTX, "t.ghost", {})
        await runnerTick(plane, { now, jobs: new Map(), execute: async () => ({}), ctx: CTX })
        assert.equal((await plane.get("nexus_job", ghost.id, CTX)).status, "dead")
        assert.truthy((await plane.get("nexus_job", ghost.id, CTX)).last_error.includes("E_HANDLER"))
        const bad = await plane.create("nexus_job", { name: "t.raw", payload: "{not json", status: "pending", run_at: new Date(clock).toISOString(), attempts: 0, max_attempts: 5 }, CTX)
        await runnerTick(plane, { now, jobs: new Map([["t.raw", {}]]), execute: async () => ({}), ctx: CTX })
        assert.equal((await plane.get("nexus_job", bad.id, CTX)).status, "dead")
        assert.truthy((await plane.get("nexus_job", bad.id, CTX)).last_error.includes("E_PAYLOAD"))
    })
```

- [ ] **Step 2: Run to verify RED** — `npm test`: JOB-01..07 RED (module missing). 0 other reds.

- [ ] **Step 3: Implement `src/core/App/jobs.js`**

```js
/**
 * The effect engine core (design 2026-07-19): claim/ack/retry/DLQ over
 * ordinary nexus_job rows. Only what cannot live above (N5) is here — the
 * CLAIM is the one adapter-level primitive (token-CAS UPDATE: portable, no
 * RETURNING, no same-table subselect, exactly one winner per row); every
 * other transition is a plain plane.update so hooks and audit see the
 * lifecycle like any data. Delivery is AT-LEAST-ONCE by design (§6).
 */

import { randomUUID } from "crypto"

export const LEASE_MS = 60000
export const BACKOFF = Object.freeze({ base: 5000, cap: 300000 })

/** Exponential backoff, clause-pinned: min(cap, base·2^attempts). */
export const backoffMs = (attempts) => Math.min(BACKOFF.cap, BACKOFF.base * 2 ** attempts)

const iso = (ms) => new Date(ms).toISOString()

/** Create a pending nexus_job row — the ONLY way work enters the engine. */
export async function enqueue(plane, ctx, name, payload = {}, { runAt, everyMs, maxAttempts } = {}) {
    return plane.create("nexus_job", {
        name,
        payload: JSON.stringify(payload ?? {}),
        status: "pending",
        run_at: runAt ?? iso(Date.now()),
        every_ms: everyMs ?? null,
        attempts: 0,
        max_attempts: maxAttempts ?? 5
    }, ctx)
}

/**
 * Claim the next due job. Token-CAS: pick a candidate, stamp it with a
 * fresh token IN ONE GUARDED UPDATE, then read the token back — if our
 * token stuck, the row is ours. Works on every dialect; two racers on the
 * same row see exactly one winner (the UPDATE's WHERE re-checks the guards).
 */
export async function claimNext(plane, { now }) {
    const t = iso(now())
    // claimable: due pending/failed rows, AND running rows whose lease expired
    // (crash recovery — a dead thread's job must never stay stuck in running)
    const DUE = `run_at <= ? AND (status IN ('pending','failed') AND (lease_until IS NULL OR lease_until < ?) OR status = 'running' AND lease_until < ?)`
    const candidates = await plane.executor.all(
        `SELECT id FROM nexus_job WHERE ${DUE} ORDER BY run_at LIMIT 1`,
        [t, t, t]
    )
    if (!candidates.length) return null
    const id = candidates[0].id
    const token = randomUUID()
    await plane.executor.run(
        `UPDATE nexus_job SET status = 'running', attempts = attempts + 1, lease_until = ?, lease_token = ? WHERE id = ? AND ${DUE}`,
        [iso(now() + LEASE_MS), token, id, t, t, t]
    )
    const rows = await plane.executor.all(`SELECT * FROM nexus_job WHERE id = ? AND lease_token = ?`, [id, token])
    return rows[0] ?? null // token didn't stick → someone else won
}

/**
 * One full lifecycle turn: claim → vet → execute → settle. Returns true if
 * a job was processed. `jobs` is the handler registry (Map name → spec);
 * `execute({ id, name, payload })` runs the handler (Task 4 puts it in a
 * thread); `ctx` is the engine's job context for the settle updates.
 */
export async function runnerTick(plane, { now, jobs, execute, ctx, log = console } = {}) {
    const row = await claimNext(plane, { now })
    if (!row) return false
    const settle = (patch) => plane.update("nexus_job", row.id, { ...patch, lease_until: null, lease_token: null }, ctx)

    let payload
    try {
        payload = row.payload ? JSON.parse(row.payload) : {}
    } catch {
        await settle({ status: "dead", last_error: "E_PAYLOAD: payload is not JSON" }) // fail LOUD — a lost job is lost work
        return true
    }
    if (!jobs.has(row.name)) {
        await settle({ status: "dead", last_error: `E_HANDLER: no handler registered for "${row.name}"` })
        return true
    }

    try {
        const result = await execute({ id: row.id, name: row.name, payload })
        if (row.every_ms) await settle({ status: "pending", attempts: 0, run_at: iso(now() + row.every_ms), result: JSON.stringify(result ?? null) })
        else await settle({ status: "done", result: JSON.stringify(result ?? null) })
    } catch (error) {
        const message = String(error?.message ?? error)
        if (row.attempts >= row.max_attempts) await settle({ status: "dead", last_error: message })
        else await settle({ status: "failed", last_error: message, run_at: iso(now() + backoffMs(row.attempts)) })
        log.warn?.(`nexus_job ${row.id} (${row.name}) attempt ${row.attempts}: ${message}`)
    }
    return true
}

export default { LEASE_MS, BACKOFF, backoffMs, enqueue, claimNext, runnerTick }
```

Note for the implementer: `attempts` was already incremented by the claim, so JOB-04's first failure computes `backoffMs(1)` — the code above passes `row.attempts` as read BEFORE the increment; read the claimed row's `attempts` value (post-increment) and adjust the test expectation only if the SELECT returns the post-update value (it does — the claim re-reads after UPDATE). The invariant to keep: first failure schedules `backoffMs(1)`, and `dead` triggers when the just-failed attempt number reaches `max_attempts`. If the arithmetic in the code disagrees with JOB-04/05 as written, fix the CODE to match the clauses.

- [ ] **Step 4: Run to verify GREEN** — `npm test`: JOB-01..07 green, 0 red.

- [ ] **Step 5: Commit**

```bash
git add src/core/App/jobs.js test/app/jobs.test.js test.js
git commit -m "Jobs engine core: token-CAS claim, backoff, DLQ, recurring reschedule, crash recovery (JOB-01..07)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: Registrar `job()` + `enqueue` on the App API

**Files:**
- Modify: `src/core/App/extensions.js`
- Test: `test/app/extensions.test.js`

**Interfaces:**
- Consumes: nothing new.
- Produces: `Extensions.jobs` (Map name → `{ run, maxAttempts }`); registrar gains `job(name, spec)` (name must match `/^[a-z][a-z0-9_.-]*$/`, `spec.run` must be a function, duplicate → throw `E_JOB_CONFLICT`); `Extensions.enqueue` is a late-bound property (default null) and the registrar exposes `enqueue: (...a) => this.enqueue?.(...a)` so app `hooks.js` modules can capture it at load and call it at runtime (the server binds it in Task 5).

- [ ] **Step 1: Write the failing clause**

Append to `test/app/extensions.test.js` (mirror its existing style — it builds an `Extensions` directly):

```js
    Test.it("EXT-J1 registrar job(): registry, name law, collision, late-bound enqueue", async () => {
        const ext = new Extensions()
        const reg = ext.registrar()
        reg.job("mail.send", { run: async () => "ok" })
        assert.equal(ext.jobs.get("mail.send").run !== undefined, true)
        assert.throws(() => reg.job("mail.send", { run: () => {} }), /E_JOB_CONFLICT/)
        assert.throws(() => reg.job("Bad Name", { run: () => {} }), /E_JOB_NAME/)
        assert.throws(() => reg.job("x.y", {}), /E_JOB_FN/)
        // enqueue is late-bound: captured at load, functional once the server binds it
        const captured = reg.enqueue
        let got = null
        ext.enqueue = (name, payload) => { got = { name, payload }; return "row" }
        assert.equal(await captured("mail.send", { to: "a" }), "row")
        assert.equal(got.name, "mail.send")
    })
```

(Import `Extensions` the way the file already does; add `assert.throws` usage matching the harness — if `assert.throws` does not exist in `src/core/Test.js`, use the file's existing try/catch pattern for expected throws instead.)

- [ ] **Step 2: RED** — `npm test`: EXT-J1 RED.

- [ ] **Step 3: Implement** in `src/core/App/extensions.js`:

Add to the class body: `jobs = new Map()` and `enqueue = null` (with a one-line comment: bound by the server once the plane exists). Add the method:

```js
    job(name, spec) {
        if (typeof name !== "string" || !/^[a-z][a-z0-9_.-]*$/.test(name)) throw err("E_JOB_NAME", `"${name}"`)
        if (typeof spec?.run !== "function") throw err("E_JOB_FN", `job "${name}" needs a run function`)
        if (this.jobs.has(name)) throw err("E_JOB_CONFLICT", `job "${name}" registered twice`)
        this.jobs.set(name, { run: spec.run, maxAttempts: spec.maxAttempts })
    }
```

Extend `registrar()`'s returned object with:

```js
            job: (name, spec) => this.job(name, spec),
            enqueue: (...a) => this.enqueue?.(...a)
```

Update the file's top docstring example to include `job`/`enqueue` (the §8.3 contract grows; names freeze on ship, N3).

- [ ] **Step 4: GREEN** — `npm test`, 0 red.
- [ ] **Step 5: Commit**

```bash
git add src/core/App/extensions.js test/app/extensions.test.js
git commit -m "App API: job() registration + late-bound enqueue on the registrar (EXT-J1)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: The job thread + the "plane" pseudo-thread RPC

**Files:**
- Create: `src/core/threads/job.js` (the worker entry)
- Create: `src/core/App/jobthread.js` (main-side: spawn worker, pseudo-thread, `executeInThread`)
- Test: `test/app/jobthread.test.js` (register in `test.js`)

**Interfaces:**
- Consumes: `Threads`/`Thread` message protocol (`src/core/Threads.js`, `src/core/Thread.js`), Task 3's registrar shape.
- Produces:
  - `startJobThread({ root, apps, config }) → { execute, stop }` — `execute({ id, name, payload }) → Promise<result>` (rejects on handler throw/timeout), `stop()` terminates.
  - Worker boot: loads each app's `hooks.js` with an inert registrar EXCEPT `job()`; also loads the effect app the same way (Task 6 wires it — this task ships the loader accepting a list of extra module URLs via `workerData.builtins`).
  - Pseudo-thread `"plane"`: main-side object with a `postMessage({ queue, method, params, source })` contract registered as `threads.threads["plane"]`; supports methods `create/update/get/list`; executes on the real plane under the ctx provided by `bindPlaneRpc(plane, ctx)`; replies by calling `threads.process({ queue, response|error }, "plane")`.
  - Worker-side sugar: inside a handler, `api.plane.create(entity, data)` / `.update(entity, id, patch)` / `.get(entity, id)` / `.list(entity, filter)` — promisified over `Thread.queue({ thread: "plane", … })`.

- [ ] **Step 1: Write the failing clauses**

`test/app/jobthread.test.js` needs a fixture app. In the test setup create a scratch dir with `apps/fx/hooks.js` (copy the mkdtemp pattern from `test/app/extensions.test.js`):

```js
export default ({ job }) => {
    job("fx.echo", { run: async ({ payload }) => ({ echoed: payload.msg }) })
    job("fx.boom", { run: async () => { throw new Error("boom in thread") } })
    job("fx.note", { run: async ({ payload }, { plane }) => plane.create("nexus_notification", { user: payload.user, title: "hi", read: false }) })
    job("fx.forbidden", { run: async (_, { plane }) => plane.create("nexus_user", { pub: "evil", name: "evil" }) })
}
```

Clauses (build the same in-memory plane as Task 2's test, schemas = SYSTEM_ENTITIES):

```js
    Test.it("THR-01 a handler executes in a REAL worker thread and returns its result", async () => {
        const result = await rig.execute({ id: "j1", name: "fx.echo", payload: { msg: "xin chào" } })
        assert.equal(result.echoed, "xin chào")
    })

    Test.it("THR-02 a handler throw rejects execute with the thread's error message", async () => {
        let error = null
        try { await rig.execute({ id: "j2", name: "fx.boom", payload: {} }) } catch (e) { error = e }
        assert.truthy(String(error.message).includes("boom in thread"))
    })

    Test.it("THR-03 plane-RPC: the thread creates a row through the narrow seam", async () => {
        await rig.execute({ id: "j3", name: "fx.note", payload: { user: "pubX" } })
        const rows = await plane.list("nexus_notification", {}, CTX)
        assert.equal(rows.length, 1)
        assert.equal(rows[0].user, "pubX")
    })

    Test.it("THR-04 plane-RPC is NOT god-mode: the job ctx denies system-entity writes", async () => {
        let error = null
        try { await rig.execute({ id: "j4", name: "fx.forbidden", payload: {} }) } catch (e) { error = e }
        assert.truthy(error, "the write must be refused")
        assert.equal((await plane.list("nexus_user", {}, ADMIN_CTX)).length, 0)
    })
```

Rig setup in the test: `rig = await startJobThread({ root: scratch, apps: [{ dir: "fx" }], config: {} })`, then `bindPlaneRpc(plane, JOB_CTX)` where `JOB_CTX`'s policies grant `create/read` on `nexus_notification` and nothing on other system entities (build it inline in the test — Task 5 ships the production one). After the suite: `await rig.stop()`.

- [ ] **Step 2: RED** — `npm test`: THR-01..04 RED (modules missing).

- [ ] **Step 3: Implement**

`src/core/threads/job.js` (the worker entry — model it on `src/core/threads/sql.js`'s structure):

```js
/**
 * The JOB worker (design §3, the Launcher discipline): handlers NEVER run on
 * the main thread. Boot loads the apps' hooks.js right here — handler code
 * lives in the thread; functions never cross the message boundary. Data
 * access is ONLY the narrow plane-RPC (4 ops) to the "plane" pseudo-thread.
 */

import { pathToFileURL } from "url"
import { join } from "path"
import Thread from "../Thread.js"

class JobThread extends Thread {
    jobs = new Map()

    /** Promisified narrow RPC to the main-side "plane" pseudo-thread. */
    rpc(method, params) {
        return new Promise((resolve, reject) => {
            this.queue({ thread: "plane", method, params, callback: (response, error) => (error ? reject(new Error(error.message ?? String(error))) : resolve(response)) })
        })
    }

    plane = {
        create: (entity, data) => this.rpc("create", { entity, data }),
        update: (entity, id, patch) => this.rpc("update", { entity, id, patch }),
        get: (entity, id) => this.rpc("get", { entity, id }),
        list: (entity, filter = null) => this.rpc("list", { entity, filter })
    }

    async init() {
        const { workerData } = await import("worker_threads")
        const { root, apps = [], builtins = [] } = workerData ?? {}
        const noop = () => {}
        const registrar = { hook: noop, endpoint: noop, command: noop, enqueue: (...a) => this.rpc("create", { entity: "nexus_job", data: undefined, enqueue: a }), job: (name, spec) => this.jobs.set(name, spec) }
        for (const url of builtins) (await import(url)).default?.(registrar, (await import(url)).context ?? {})
        for (const app of apps) {
            const path = join(root, "apps", app.dir, "hooks.js")
            try { (await import(pathToFileURL(path).href)).default?.(registrar) } catch { /* app without hooks.js */ }
        }
    }

    /** Invoked by the main thread per job: { id, name, payload }. */
    async run({ id, name, payload }) {
        await this.ready
        const spec = this.jobs.get(name)
        if (!spec) throw new Error(`E_HANDLER: "${name}" not registered in the job thread`)
        return await spec.run({ id, payload }, { plane: this.plane })
    }
}

new JobThread()
```

(Adjust the `enqueue`-inside-thread line to simply `enqueue: () => { throw new Error("E_THREAD_ENQUEUE: enqueue jobs from hooks/endpoints, not from inside a handler") }` — v1 keeps handler-side enqueue out; simpler and honest. The clause suite does not exercise it.)

`src/core/App/jobthread.js` (main side):

```js
/**
 * Main-side of the job thread (design §3): spawn the worker, expose
 * execute(), and register the "plane" PSEUDO-THREAD — an object honoring
 * the Threads postMessage contract, so worker→main RPC rides the existing
 * message protocol with zero kernel changes. The RPC is the narrow seam:
 * four ops, one job-scoped ctx, never god-mode.
 */

import { threads } from "../Threads.js"

const EXEC_TIMEOUT_MS = 60000

/** Register (or replace) the narrow plane RPC under `ctx`. */
export function bindPlaneRpc(plane, ctx) {
    const ops = {
        create: ({ entity, data }) => plane.create(entity, data, ctx),
        update: ({ entity, id, patch }) => plane.update(entity, id, patch, ctx),
        get: ({ entity, id }) => plane.get(entity, id, ctx),
        list: ({ entity, filter }) => plane.list(entity, filter ?? {}, ctx)
    }
    threads.threads["plane"] = {
        postMessage: async ({ queue, method, params }) => {
            try {
                if (!ops[method]) throw new Error(`E_RPC: unknown op "${method}"`)
                const response = await ops[method](params ?? {})
                threads.process({ queue, response }, "plane")
            } catch (error) {
                threads.process({ queue, error: { message: String(error?.message ?? error) } }, "plane")
            }
        },
        removeAllListeners() {},
        terminate() {}
    }
}

/** Spawn the job worker; returns { execute, stop }. */
export async function startJobThread({ root, apps = [], builtins = [] } = {}) {
    const url = new URL("../threads/job.js", import.meta.url)
    await threads.register("job", { worker: true, url, workerData: { root, apps, builtins } })
    const execute = ({ id, name, payload }) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("E_TIMEOUT: job thread did not answer")), EXEC_TIMEOUT_MS)
        threads.queue({ thread: "job", method: "run", params: { id, name, payload }, callback: (response, error) => {
            clearTimeout(timer)
            error ? reject(new Error(error.message ?? String(error))) : resolve(response)
        } })
    })
    const stop = async () => { await threads.terminate("job"); delete threads.threads["plane"] }
    return { execute, stop }
}

export default { bindPlaneRpc, startJobThread }
```

Implementation notes (read before coding): `Threads.register` passes `configs` straight to `new Worker(url, configs)`, so `workerData` rides through on Node. THR-04's denial path: `plane.create` under a ctx with no `nexus_user` grant throws (deny-by-default) — the RPC catches and routes the error back; assert on the rejection, not its exact message.

- [ ] **Step 4: GREEN** — `npm test`: THR-01..04 green; browser-side suites untouched; 0 red.
- [ ] **Step 5: Commit**

```bash
git add src/core/threads/job.js src/core/App/jobthread.js test/app/jobthread.test.js test.js
git commit -m "Job thread: handlers run off-main behind the Launcher discipline; plane pseudo-thread is the narrow RPC (THR-01..04)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 5: Runner wired into the server

**Files:**
- Modify: `src/core/HTTP/server.js`
- Test: `test/http/jobs-live.test.js` (create; register in `test.js`)

**Interfaces:**
- Consumes: Tasks 2–4 (`runnerTick`, `startJobThread`, `bindPlaneRpc`, `Extensions.jobs/enqueue`).
- Produces: `buildInstanceApi` starts the effect runner when `mode` is `"dev"` or `"production"`: binds `extensions.enqueue = (name, payload, opts) => enqueue(plane, JOB_CTX, name, payload, opts)`; builds `JOB_CTX` (policies: every action on every NON-system entity — generated like `devPolicies` — plus `create`/`read` on `nexus_notification` and `read` on `nexus_webhook`; nothing else); `bindPlaneRpc(plane, JOB_CTX)`; `startJobThread({ root, apps, builtins })`; an interval loop `setInterval(tick, config.jobs?.poll_ms ?? 1000)` where `tick` runs `runnerTick(plane, { now: Date.now, jobs: extensions.jobs, execute, ctx: JOB_CTX })` in a drain loop (keep ticking while it returns true) with a re-entrancy guard. The return object gains `effects: { stop }` (stops the interval + thread) so dev/tests shut down cleanly; dev.js hot-reload path calls `effects.stop()` before rebuilding (mirror how it re-destructures the rest).

- [ ] **Step 1: Write the failing clause**

`test/http/jobs-live.test.js` — real dev server, real thread, end to end (copy the server-boot helper from `test/http/policy-window.test.js`; scratch instance via `nexus create`; write `apps/starter/hooks.js` BEFORE boot):

```js
export default ({ hook, endpoint, command, job, enqueue }) => {
    job("starter.mark", { run: async ({ payload }, { plane }) => plane.create("nexus_notification", { user: payload.user, title: "marked", read: false }) })
    endpoint("POST", "mark", async () => ({ queued: (await enqueue("starter.mark", { user: "pubZ" })).id }))
}
```

```js
    Test.it("JOBL-01 endpoint enqueues → runner claims → thread executes → notification row lands (no restart, real process)", async () => {
        const q = await post("/api/v1/_/mark", {})
        assert.equal(q.body.ok, true)
        // poll the API (not the clock): the runner ticks at poll_ms=1000 in dev
        let rows = []
        for (let i = 0; i < 30 && !rows.length; i++) {
            await new Promise((r) => setTimeout(r, 500))
            const res = await post("/api/v1/nexus_notification/query", { filter: null, limit: 10 })
            rows = res.body.ok ? res.body.data : []
        }
        assert.equal(rows.length, 1)
        assert.equal(rows[0].user, "pubZ")
        const jobs = await post("/api/v1/nexus_job/query", { filter: null, limit: 10 })
        assert.equal(jobs.body.data[0].status, "done")
    })
```

(This clause is the ONE place the suite waits on real time — it is polling a live server like the dev-boot helpers already do, bounded at 15 s. The engine's timing logic itself is clock-injected and covered by JOB-*.)

- [ ] **Step 2: RED** — the endpoint 500s (`enqueue` unbound) or the row never lands.

- [ ] **Step 3: Implement** in `src/core/HTTP/server.js` (inside `buildInstanceApi`, after the api/context wiring):

```js
        // ── the effect runner (design §2/§3): claims on main, executes in the
        // job THREAD, settles through the plane. Server-mode only — effects
        // never replicate (§6). JOB_CTX is deliberately not god-mode.
        const JOB_CTX = {
            user: "nexus-jobs", roles: [], shares: [],
            policies: [
                ...allSchemas.filter((s) => !isSystem(s.name)).map((s) => ({ entity: s.name, actions: [...ACTIONS], rule: null, permlevel: 0, ifOwner: false })),
                { entity: "nexus_job", actions: ["read", "create", "write"], rule: null, permlevel: 0, ifOwner: false },
                { entity: "nexus_notification", actions: ["read", "create"], rule: null, permlevel: 0, ifOwner: false },
                { entity: "nexus_webhook", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }
            ]
        }
        extensions.enqueue = (name, payload, opts) => enqueue(plane, JOB_CTX, name, payload, opts)
        bindPlaneRpc(plane, JOB_CTX)
        const jobThread = await startJobThread({ root, apps, builtins: [new URL("../App/effects.js", import.meta.url).href] })
        let draining = false
        const tick = async () => {
            if (draining) return
            draining = true
            try { while (await runnerTick(plane, { now: Date.now, jobs: extensions.jobs, execute: jobThread.execute, ctx: JOB_CTX })) {} } finally { draining = false }
        }
        const poller = setInterval(tick, config.jobs?.poll_ms ?? 1000)
        const effects = { stop: async () => { clearInterval(poller); await jobThread.stop() } }
```

Imports to extend: `enqueue, runnerTick` from `../App/jobs.js`; `bindPlaneRpc, startJobThread` from `../App/jobthread.js`; `isSystem` is already imported? (check the system.js import line; add if missing); `ACTIONS` from `../Permission.js` (check existing imports). Add `effects` to the return object. In `src/cli/commands/dev.js`, the hot-reload function must call `await effects.stop()` before re-invoking `buildInstanceApi` and re-destructure `effects` in both destructuring sites (the `policyLayers` precedent — same two lines). NOTE: Task 6 creates `src/core/App/effects.js`; until it lands, pass `builtins: []` — the Task 6 implementer flips it. Keep the `builtins` line commented with `// Task 6 wires effects.js here` and pass `[]` so this task is green standalone.

- [ ] **Step 4: GREEN** — `npm test`: JOBL-01 green; POLWIN/STUDIO suites still green (the runner must not disturb them); 0 red.
- [ ] **Step 5: Commit**

```bash
git add src/core/HTTP/server.js src/cli/commands/dev.js test/http/jobs-live.test.js test.js
git commit -m "Effect runner lives in the server: enqueue bound, thread spawned, drain loop on poll_ms (JOBL-01)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 6: The effect app — webhook consumer

**Files:**
- Create: `src/core/App/effects.js`
- Modify: `src/core/HTTP/server.js` (load effects into extensions + builtins list)
- Test: `test/app/effects.test.js` (pure parts; register in `test.js`) and extend `test/http/jobs-live.test.js` (live webhook)

**Interfaces:**
- Consumes: registrar surface (Task 3), thread builtins loading (Task 4), runner (Task 5).
- Produces: `effects.js` default-exports `function effects(registrar, { schemas = [], plane = null, ctx = null } = {})`. On MAIN (plane provided): for every schema except `nexus_job`, registers `after:create/update/remove` hooks that read enabled `nexus_webhook` rows (via `plane.list` under `ctx`), match `entity` (null/empty = all) + event (parsed `events` JSON, null/empty = all), and `registrar.enqueue("effects.webhook", { url, secret, body: { entity, event, id, ts } })` per match. On BOTH main and thread: registers handlers `effects.webhook` (fetch + HMAC), `effects.notify`, `effects.mail` (mail lands Task 7 — register it in Task 7). Pure export `sign(secret, body) → hex HMAC-SHA256 of the JSON string` (node:crypto).

- [ ] **Step 1: Write the failing clauses**

`test/app/effects.test.js` (pure):

```js
    Test.it("WH-01 sign(): HMAC-SHA256 hex over the exact JSON body", () => {
        const body = { entity: "task", event: "after:create", id: "r1", ts: 1000 }
        const expected = createHmac("sha256", "s3cret").update(JSON.stringify(body)).digest("hex")
        assert.equal(sign("s3cret", body), expected)
    })
```

Extend `test/http/jobs-live.test.js` with a real receiver (plain `node:http` server on port 0 inside the test):

```js
    Test.it("WH-02 a row write fires the webhook: signed, delivery-id'd, retried to DLQ on 500", async () => {
        const seen = []
        const rx = createServer((req, res) => {
            let raw = ""
            req.on("data", (c) => (raw += c))
            req.on("end", () => {
                seen.push({ raw, sig: req.headers["x-nexus-signature"], delivery: req.headers["x-nexus-delivery"] })
                res.writeHead(seen.length === 1 ? 200 : 500).end()
            })
        })
        await new Promise((r) => rx.listen(0, r))
        const rxUrl = `http://127.0.0.1:${rx.address().port}/hook`
        // subscribe via ordinary rows — the editor's own write path
        await post("/api/v1/nexus_webhook", { url: rxUrl, entity: "task", events: JSON.stringify(["after:create"]), secret: "s3cret", enabled: true })
        await post("/api/v1/task", { title: "fire one" })
        for (let i = 0; i < 30 && seen.length < 1; i++) await new Promise((r) => setTimeout(r, 500))
        assert.equal(seen.length >= 1, true, "the webhook fired")
        const body = JSON.parse(seen[0].raw)
        assert.equal(body.entity, "task")
        assert.equal(body.event, "after:create")
        assert.equal(seen[0].sig, sign("s3cret", body))
        assert.truthy(seen[0].delivery)
        rx.close()
    })
```

(Import `sign` from `../../src/core/App/effects.js` and `createServer` from `http`. The retry-to-DLQ tail of WH-02's name is proven by the 500 second-response plus a follow-up write in the same clause ONLY if cheap; otherwise pin retry at the JOB-04 level and keep WH-02 to fire+signature — implementer judgment, but the clause must assert what its name claims, so rename to match what is asserted.)

- [ ] **Step 2: RED** — `npm test`.

- [ ] **Step 3: Implement `src/core/App/effects.js`**

```js
/**
 * The EFFECT APP (design §5) — nexus's first consumers, written against the
 * registrar surface every third-party app gets (§361 applied twice): if this
 * file can build webhooks with public surface, any app can build any effect.
 * Loaded twice by design: on MAIN (hooks + registry) and inside the job
 * THREAD (handlers only — plane arrives as the narrow RPC).
 */

import { createHmac } from "crypto"

/** HMAC-SHA256 hex over the canonical JSON body — receivers verify with the row's secret. */
export function sign(secret, body) {
    return createHmac("sha256", String(secret ?? "")).update(JSON.stringify(body)).digest("hex")
}

const EVENTS = ["after:create", "after:update", "after:remove"]

export default function effects(registrar, { schemas = [], plane = null, ctx = null } = {}) {
    // ── consumers (run in the job thread; harmless to register on main too)
    registrar.job("effects.webhook", {
        run: async ({ id, payload }) => {
            const res = await fetch(payload.url, {
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    "x-nexus-signature": sign(payload.secret, payload.body),
                    "x-nexus-delivery": String(id)
                },
                body: JSON.stringify(payload.body)
            })
            if (!res.ok) throw new Error(`E_WEBHOOK: receiver answered ${res.status}`)
            return { status: res.status }
        }
    })
    registrar.job("effects.notify", {
        run: async ({ payload }, { plane: rpc }) => rpc.create("nexus_notification", { user: payload.user, title: payload.title, body: payload.body ?? null, href: payload.href ?? null, read: false })
    })

    // ── emitters (main only: they need the real plane to read subscriptions)
    if (!plane) return
    const fire = (entity, event) => async (payload) => {
        const hooks = await plane.list("nexus_webhook", {}, ctx)
        const id = payload.row?.id ?? payload.id
        for (const row of hooks) {
            if (!row.enabled) continue
            if (row.entity && row.entity !== entity) continue
            const events = row.events ? JSON.parse(row.events) : null
            if (events?.length && !events.includes(event)) continue
            await registrar.enqueue("effects.webhook", { url: row.url, secret: row.secret, body: { entity, event, id, ts: Date.now() } })
        }
    }
    for (const s of schemas) {
        if (s.name === "nexus_job") continue // effects on the effect ledger = feedback loop
        for (const event of EVENTS) registrar.hook(s.name, event, fire(s.name, event))
    }
}
```

Wire in `src/core/HTTP/server.js`: after `loadExtensions` returns (find where `extensions` is built — likely passed in or built in the caller; put this where extensions and allSchemas both exist, BEFORE the runner block from Task 5):

```js
        const { default: effectsApp } = await import("../App/effects.js")
        effectsApp(extensions.registrar(), { schemas: allSchemas, plane, ctx: JOB_CTX })
```

Careful with ordering: `JOB_CTX` must exist first — move the JOB_CTX declaration above this call; and flip Task 5's `builtins: []` to `builtins: [new URL("../App/effects.js", import.meta.url).href]` so the thread registers the handlers too. In the thread, `effects.js` is imported with `registrar` only (no plane) — the `if (!plane) return` line keeps emitters main-only. One wrinkle the implementer must handle: `registrar.enqueue` inside `fire` runs at hook time on MAIN, where `extensions.enqueue` is bound — fine; `registrar.job` on main puts handlers in `extensions.jobs` so the runner's registry knows the names (execution still goes to the thread).

- [ ] **Step 4: GREEN** — `npm test`, 0 red.
- [ ] **Step 5: Commit**

```bash
git add src/core/App/effects.js src/core/HTTP/server.js test/app/effects.test.js test/http/jobs-live.test.js test.js
git commit -m "Effect app: webhook emitter+handler and notify on the public registrar (WH-01/02)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 7: Mail provider seam + effects.mail

**Files:**
- Create: `src/core/App/mailer.js`
- Modify: `src/core/App/effects.js` (register `effects.mail`)
- Test: `test/app/effects.test.js` (extend)

**Interfaces:**
- Consumes: Task 6's effects module shape; the transformers.js instance-dependency pattern (`src/core/App/models.js` `libInstalled`/`createRequire`).
- Produces: `mailProvider(config, root) → { send({ to, subject, text, html }) → { id } }`:
  - `config.mail?.provider === "smtp"` → resolve `nodemailer` from the INSTANCE root via `createRequire(join(root, "package.json"))`; missing → throw `E_PROVIDER: the smtp provider needs nodemailer — run: npm install nodemailer`; build transport from `config.mail.smtp` and `sendMail` with `from: config.mail.from`.
  - anything else (default `"log"`) → `{ send }` that `console.log`s one line `mail(log): to=<to> subject=<subject>` and returns `{ id: "log-" + Date.now() }` — dev and CI never need SMTP.

- [ ] **Step 1: Write the failing clauses** (append to `test/app/effects.test.js`):

```js
    Test.it("MAIL-01 the log provider sends without any dependency; smtp without nodemailer fails with E_PROVIDER", async () => {
        const log = mailProvider({}, "/nonexistent")
        const sent = await log.send({ to: "a@b.c", subject: "hi", text: "t" })
        assert.truthy(sent.id.startsWith("log-"))
        let error = null
        try { mailProvider({ mail: { provider: "smtp" } }, "/nonexistent") } catch (e) { error = e }
        assert.truthy(String(error?.message).startsWith("E_PROVIDER"))
    })
```

- [ ] **Step 2: RED.**

- [ ] **Step 3: Implement `src/core/App/mailer.js`**:

```js
/**
 * Mail provider seam (design §5): the kernel defines the interface; the
 * transport is the INSTANCE's business (N2 — the transformers.js pattern).
 * "log" is the zero-dep default so dev/CI never need SMTP.
 */

export function mailProvider(config = {}, root = process.cwd()) {
    const kind = config.mail?.provider ?? "log"
    if (kind === "smtp") {
        let nodemailer
        try {
            const { createRequire } = process.getBuiltinModule("module")
            const { join } = process.getBuiltinModule("path")
            nodemailer = createRequire(join(root, "package.json"))("nodemailer")
        } catch {
            throw new Error("E_PROVIDER: the smtp provider needs nodemailer — run: npm install nodemailer")
        }
        const transport = nodemailer.createTransport(config.mail?.smtp ?? {})
        return { send: async (mail) => { const info = await transport.sendMail({ from: config.mail?.from, ...mail }); return { id: info.messageId } } }
    }
    return { send: async ({ to, subject }) => { console.log(`mail(log): to=${to} subject=${subject}`); return { id: "log-" + Date.now() } } }
}

export default { mailProvider }
```

In `effects.js`, register (inside the consumer block, after `effects.notify`; `mailProvider` imported at top; config/root arrive via a third context field — extend the default-export signature to `(registrar, { schemas, plane, ctx, config = {}, root = process.cwd() } = {})` and pass `config`/`root` from BOTH loaders: server-side call gains `config, root`; the thread side gets them via `workerData` — extend Task 4's `workerData` object with `{ root, apps, builtins, config }` and `job.js`'s init to pass `{ config, root }` when importing builtins):

```js
    registrar.job("effects.mail", {
        run: async ({ payload }) => mailProvider(config, root).send(payload)
    })
```

- [ ] **Step 4: GREEN** — `npm test`; also confirm JOBL/WH clauses still green (workerData shape changed).
- [ ] **Step 5: Commit**

```bash
git add src/core/App/mailer.js src/core/App/effects.js src/core/threads/job.js src/core/App/jobthread.js test/app/effects.test.js
git commit -m "Mail provider seam: log by default, nodemailer as the instance's business (MAIL-01)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 8: Notification consumer proven live

**Files:**
- Test: extend `test/http/jobs-live.test.js`

The `effects.notify` handler already exists (Task 6) and THR-03 proved the RPC path; this task pins the PUBLIC contract end-to-end (an app enqueues `effects.notify` and the row lands, through the real server + thread).

- [ ] **Step 1: Write the failing clause** — add to the fixture `apps/starter/hooks.js` an endpoint `POST notify` that calls `enqueue("effects.notify", { user: "pubN", title: "hello" })`; clause:

```js
    Test.it("NOTIF-01 effects.notify through the whole machine: enqueue → thread → row for the right user", async () => {
        const q = await post("/api/v1/_/notify", {})
        assert.equal(q.body.ok, true)
        let rows = []
        for (let i = 0; i < 30 && !rows.some((r) => r.user === "pubN"); i++) {
            await new Promise((r) => setTimeout(r, 500))
            const res = await post("/api/v1/nexus_notification/query", { filter: null, limit: 20 })
            rows = res.body.ok ? res.body.data : []
        }
        const mine = rows.filter((r) => r.user === "pubN")
        assert.equal(mine.length, 1)
        assert.equal(mine[0].title, "hello")
    })
```

- [ ] **Step 2: RED** (endpoint missing) → add the endpoint to the fixture → **Step 3: GREEN** — `npm test`, 0 red.
- [ ] **Step 4: Commit**

```bash
git add test/http/jobs-live.test.js
git commit -m "Notification consumer pinned live: enqueue to row through server+thread (NOTIF-01)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 9: Studio /jobs page

**Files:**
- Create: `src/studio/routes/jobs/index.js`, `src/studio/routes/jobs/template.js`
- Create: `src/i18n/dict/jobs.yaml`
- Modify: `src/cli/commands/dev.js` (STUDIO_VIEWS gains `"jobs"`), the Studio sidebar (find where the `permissions`/`users` navlinks are declared — `grep -n "permissions" src/studio/layouts/studio/*.js` — and add a `jobs` entry in the same shape, same icon idiom)

UI-only (no clause; suite green is the regression bar; page joins the manual browser pass). Template mirrors `/users`'s head+card structure; logic:

```js
/** /jobs route — the DLQ front and center (design §7): nexus_job rows
 *  grouped by status, Retry = an ordinary entity-API update. */

import { mountTemplate, button, toast } from "../../kit/index.js"
import { jobsTemplate } from "./template.js"

const GROUPS = ["dead", "failed", "running", "pending", "done"]

export function render(ctx) {
    const c = {}
    const host = mountTemplate(jobsTemplate(c))

    async function load() {
        const r = await ctx.api.list("nexus_job", null)
        const rows = r.ok ? r.data : []
        c.$body.replaceChildren()
        for (const status of GROUPS) {
            const bucket = rows.filter((x) => x.status === status)
            if (!bucket.length) continue
            const h = document.createElement("h3")
            h.textContent = `${status} · ${bucket.length}`
            c.$body.append(h)
            for (const row of bucket) {
                const line = document.createElement("div")
                line.className = "nx-row"
                const who = document.createElement("div")
                who.className = "nx-who"
                const name = document.createElement("div")
                name.textContent = row.name
                const detail = document.createElement("div")
                detail.className = "nx-pub"
                detail.textContent = [`attempts ${row.attempts}/${row.max_attempts}`, row.run_at && `runs ${row.run_at}`, row.last_error].filter(Boolean).join(" · ")
                who.append(name, detail)
                line.append(who)
                if (status === "dead" || status === "failed") {
                    line.append(button({
                        onclick: async () => {
                            const res = await ctx.api.update("nexus_job", row.id, { status: "pending", attempts: 0, lease_until: null, lease_token: null, last_error: null })
                            toast(res.ok ? "Requeued" : res.error.code, res.ok ? "ok" : "err")
                            load()
                        }
                    }, ["Retry"]))
                }
                c.$body.append(line)
            }
        }
        if (!rows.length) {
            const none = document.createElement("p")
            none.className = "nx-muted"
            none.textContent = "No jobs yet — enqueue from a hook or endpoint with enqueue(name, payload)."
            c.$body.append(none)
        }
    }
    load()
    return host
}
```

`template.js` mirrors the permissions template's head (`<nx-context data-key="jobs">`) + one `nx-card` bound to `c.$body`. `jobs.yaml` mirrors `users.yaml`'s two-line shape with `en: Jobs` / `vi: Tác vụ`.

- [ ] Implement, run `npm test` (green), commit:

```bash
git add src/studio/routes/jobs src/i18n/dict/jobs.yaml src/cli/commands/dev.js src/studio/layouts/studio
git commit -m "Studio /jobs: the DLQ is visible and retryable through the ordinary API

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 10: STATUS.md + final sweep

**Files:**
- Modify: `STATUS.md`

- [ ] Add an "Effect engine" row to the Implemented table: durable jobs as `nexus_job` rows (token-CAS claim, backoff, DLQ, recurring), Threads execution behind the narrow plane-RPC, webhook/mail/notification consumers as the effect app, Studio /jobs — clauses `SYS-09, JOB-*, EXT-J1, THR-*, JOBL-*, WH-*, MAIL-*, NOTIF-*`. In "Unfinished", add honest bullets: at-least-once semantics documented (no exactly-once); smtp path exercised only through the provider-resolution clause (no live SMTP in CI); job/webhook sync exclusion is a pinned list — enforcement wiring lands with server-side sync; cron syntax and multi-process workers deferred by spec.
- [ ] `npm test` — expected ≈ 498 + ~14 new clauses, 0 red. Real-flow: scratch instance, add the fixture hook, watch a webhook hit a local receiver (the JOBL/WH clauses already do this — cite their output).
- [ ] Commit:

```bash
git add STATUS.md
git commit -m "STATUS: the effect layer is real — jobs, thread execution, webhook/mail/notification (JOB/THR/WH/MAIL/NOTIF)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
