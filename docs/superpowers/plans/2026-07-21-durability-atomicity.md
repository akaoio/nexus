# Durability & Atomicity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** a write either fully happened or fully did not, and the system tells the caller the truth about which. Closes issue #9's I6, I7, I8, I9, I11 plus the TOCTOU and WAL/`busy_timeout` moderates.

**Architecture:** one structural addition — a real transaction seam on the executor contract — then every atomicity fix is a consumer of it. `adapters.js` stays declaration-only (browser-safe, VND-07); drivers stay in `executor.js`. The entity-delete executor moves out of `dev.js` into `src/core/App/lifecycle.js` so it is testable in-process at all.

**Tech Stack:** Node ESM zero-dep kernel; vendored Kysely behind the compile boundary; `node:sqlite` (built-in), Turso, PGlite for the live matrix; the repo's own runner (`node test.js`).

**Spec:** `docs/superpowers/specs/2026-07-21-durability-atomicity-design.md` · **Issue:** #9

## Global Constraints

- Spec-first TDD: every clause RED before its fix. **Baseline: 623 green / 0 red / 46 skipped** on `main` @ `164b455` (Linux). End state 0 red, and the skip count must not grow.
- No new runtime dependency (N2). No Node built-in may enter `adapters.js` or any module a browser graph reaches — VND-07 pins this and must stay green.
- App API v1 changes are additive only, except the one declared behaviour change in Task 5 (after-hook failures no longer fail the write), which lands with `onHookError`, a clause, and a STATUS entry (N3).
- Every silent `catch {}` this plan touches is removed, not relocated.
- Commit style: repo sentence style, one concern per commit; every commit ends with `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`.

---

### Task 1: The executor grows a real transaction seam

**Files:** Modify `src/core/Data/adapters.js`, `src/core/Data/executor.js` · Test `test/data/transaction.test.js` (create; register in `test.js`)

**Interfaces produced:** `executor.transaction(async (tx) => …)` where `tx = { run, all }`; `CAPABILITIES[engine].transactions`.

- [ ] **Step 1: Clause (RED)** — `ADP-TXN`: every engine in `CAPABILITIES` declares `transactions: true`, `transactionalDDL` is unchanged (mysql still `false`), and `capabilitiesFor("nope")` still throws `E_ENGINE`.
- [ ] **Step 2: Clause (RED)** — `TXN-01`: on sqlite, a callback that returns commits its writes and yields its return value; a callback that throws leaves the table as it was and re-throws **the original error** (not a rollback error).
- [ ] **Step 3: Clause (RED)** — `TXN-03`: calling `tx.transaction` from inside a callback throws `E_NESTED_TX` (the `tx` handed out has no nesting).
- [ ] **Step 4: Clause (RED)** — `TXN-04`: the sqlite/turso path opens with `BEGIN IMMEDIATE`, not bare `BEGIN`. Assert by recording the SQL a wrapped executor actually issues.
- [ ] **Step 5: Clause (RED)** — `TXN-02`: the §0 finding, made provable without a live cluster. Drive the postgres branch with a **fake pool** whose `connect()` hands out distinguishable clients and whose `query()` records which client served each statement. Assert every statement of one `transaction()` callback — `BEGIN`, the body, `COMMIT` — ran on the **same** client, and that the client was released exactly once even when the callback threw.
- [ ] **Step 6: Implement** — add `transactions: true` to all four `CAPABILITIES` records. In `executor.js`, give each branch a `transaction(fn)`:
  - sqlite/turso: `BEGIN IMMEDIATE` / `COMMIT` / `ROLLBACK` on the one handle.
  - postgres (PGlite): same on the one instance. postgres (`pg`): `pool.connect()` → run everything on that client → `release()` in `finally`.
  - mysql: `pool.getConnection()` → same shape → `release()` in `finally`.
  - Shared rule in one helper so the commit/rollback/re-throw logic exists once: rollback failures append to the original error's message, never replace it.
- [ ] **Step 7: Verify** — `node test.js` — Task 1 clauses green, 623 prior clauses still green, VND-07 still green.

---

### Task 2: `applyMigration` stops improvising, and hot apply gets its envelope (I9)

**Files:** Modify `src/core/Data/migrate.js` · Test `test/data/migrate-tx.test.js` (create; register in `test.js`)

**Interfaces produced:** `hotApply` returns `{ applied, statements, atomic }` (widened, additive).

- [ ] **Step 1: Clause (RED)** — `MIG-HOTTX-01`: a hot change set whose **second** statement fails leaves the table exactly as it was on a transactional-DDL engine (no half-applied column/index).
- [ ] **Step 2: Clause (RED)** — `MIG-HOTTX-02`: on an engine declaring `transactionalDDL: false`, `hotApply` still performs the work and returns `atomic: false` — it does **not** refuse (§5's deliberate asymmetry with Task 7).
- [ ] **Step 3: Implement** — `hotApply` wraps its statement loop in `executor.transaction()` when `capabilitiesFor(engineOf(dialect)).transactionalDDL`, else runs the existing loop and reports `atomic: false`. Replace `applyMigration`'s literal `BEGIN`/`COMMIT`/`ROLLBACK` `run()` calls with `executor.transaction()`; the `E_NO_TRANSACTIONAL_DDL` refusal stays **ahead** of it, untouched.
- [ ] **Step 4: Verify** — `node test.js`; `MIG-NOTX` and every existing `MIG-*`/`DDL-*` clause still green.

---

### Task 3: SQLite WAL + `busy_timeout`

**Files:** Modify `src/core/Data/executor.js`, `src/cli/commands/doctor.js` · Test `test/data/wal.test.js` (create; register in `test.js`)

- [ ] **Step 1: Clause (RED)** — `ADP-WAL-01`: a **file-backed** sqlite executor reports `journal_mode = wal` and the configured `busy_timeout`; a `:memory:` executor is never asked for WAL and honestly reports `memory`. Assert the *reported* mode, not the pragma call.
- [ ] **Step 2: Implement** — at sqlite executor construction: `PRAGMA journal_mode = WAL` for file paths only (skip `:memory:`), `PRAGMA busy_timeout = <config.busyTimeoutMs ?? 5000>`. Surface both in `nexus doctor` output.
- [ ] **Step 3: Verify** — `node test.js`; `CLI-*` doctor clauses still green.

---

### Task 4: The permission predicate rides the write statement (TOCTOU)

**Files:** Modify `src/core/Data.js` · Test `test/data/toctou.test.js` (create; register in `test.js`)

- [ ] **Step 1: Clause (RED)** — `DPL-TOCTOU-01`: `update` and `remove` compile a write whose WHERE carries the permission predicate as well as the id; a row that no longer satisfies the rule is not written and the call reports `E_NOT_FOUND` (same opacity as a missing row — no new error channel, no existence leak).
- [ ] **Step 2: Implement** — build the `UPDATE`/`DELETE` through `applyWhere` with the same injected `where` the pre-image `SELECT` uses, instead of `.where("id","=",id)` alone. Zero rows affected → throw `E_NOT_FOUND`.
- [ ] **Step 3: Verify** — `node test.js`; every existing `DPL-*`, `PERM-*` and `SEC-*` clause still green.

---

### Task 5: Writes are atomic with derived state; after-hooks are contained (I7)

**Files:** Modify `src/core/Data.js`, `src/core/HTTP/server.js` · Test `test/data/atomic-write.test.js` (create; register in `test.js`)

**Interfaces produced:** `new DataPlane({ …, onHookError })`; default sink logs entity, event and error.

- [ ] **Step 1: Clause (RED)** — `DPL-ATOMIC-01`: an embedder that throws leaves **no** row behind on `create`, and leaves the pre-image intact on `update`. The caller's error is therefore true and a retry is correct.
- [ ] **Step 2: Clause (RED)** — `DPL-ATOMIC-02`: a throwing `after:create`/`after:update`/`after:remove` hook does not fail the call, and the row is durable afterwards.
- [ ] **Step 3: Clause (RED)** — `DPL-ATOMIC-03`: that same failure reaches `onHookError` carrying entity and event — contained, never swallowed.
- [ ] **Step 4: Clause (RED)** — `DPL-ATOMIC-04`: a throwing `before:` hook still vetoes, and leaves no row (the veto contract is unchanged).
- [ ] **Step 5: Implement** — restructure `create`/`update`/`remove`:
  - `before:` hooks and validation stay **outside**, before the transaction opens.
  - `executor.transaction()` contains: pre-image `SELECT` (update/remove), the post-image predicate check, the write, and `#maintainEmbedding`/`#dropEmbedding`.
  - `after:` hooks run **after commit**, each wrapped so a throw routes to `onHookError` and never propagates.
  - The reply projection (READ-scoped, C2) is unchanged.
  - Wire `onHookError` to the request log in `server.js`.
- [ ] **Step 6: Verify** — `node test.js`; every `DPL-*`, `SEM-*`, `VEC-*`, `WH-*`, `EVT-*`, `JOB-*` clause still green (hooks and embeddings are load-bearing for all of them).

---

### Task 6: `after:remove` stops leaking ids past the row rule (I11)

**Files:** Modify `src/core/Data.js`, `src/core/HTTP/events.js`, `src/core/App/extensions.js` (doc only) · Test `test/http/event-rowgate.test.js` (create; register in `test.js`)

**Interfaces produced:** `before:remove` / `after:remove` payload becomes `{ id, row }` (additive).

- [ ] **Step 1: Clause (RED)** — `EVT-ROWGATE-01`: a subscriber holding document-level read, whose row `rule` excludes the removed row, does **not** receive the remove event.
- [ ] **Step 2: Clause (RED)** — `EVT-ROWGATE-02`: a subscriber whose rule **does** match still receives it — the fix narrows, it does not blind.
- [ ] **Step 3: Clause (RED)** — `EVT-ROWGATE-03`: the emitted frame is still exactly `{entity,event,id,ts}`. No field of the captured row reaches the wire.
- [ ] **Step 4: Clause (RED)** — `EVT-ROWGATE-04`: a remove event arriving with no captured row **denies** rather than falling back to the old permissive document-level answer.
- [ ] **Step 5: Implement** — `remove()` selects the full pre-image inside its transaction and passes `row` on both remove payloads; `visible()` for `remove` evaluates `resolve().allowed && (filter === null || AST.predicate(filter)(row))`, still cannot throw, and denies when `row` is absent.
- [ ] **Step 6: Verify** — `node test.js`; every `EVT-*` and `EVT-U*` clause still green.

---

### Task 7: Entity delete becomes one transaction in core (I8)

**Files:** Create `applyEntityDelete` in `src/core/App/lifecycle.js` · Modify `src/cli/commands/dev.js` · Test `test/app/entity-delete.test.js` (create; register in `test.js`)

**Interfaces produced:** `applyEntityDelete({ plane, root, plan, fs })` → `{ deleted, plan }`.

- [ ] **Step 1: Clause (RED)** — `LIFE-TX-01`: a `DROP COLUMN` that fails mid-cascade rolls back the policy rows, view rows and the table — nothing is left half-deleted.
- [ ] **Step 2: Clause (RED)** — `LIFE-TX-02`: when the DB transaction fails, **no** schema file has been written or removed.
- [ ] **Step 3: Clause (RED)** — `LIFE-TX-03`: an engine declaring `transactionalDDL: false` refuses with `E_NO_TRANSACTIONAL_DDL` **before any statement runs** (reusing C5's code and shape).
- [ ] **Step 4: Clause (RED)** — `LIFE-TX-04`: the happy path performs exactly what `entityDeletePlan` named — the policies, views, link drops, embeddings, table and file it listed, and nothing else.
- [ ] **Step 5: Implement** — move the executor body out of `dev.js` into `lifecycle.js` in the §4 order: compute new file bodies in memory → one transaction (policies → views → `DROP COLUMN`s → embeddings → `DROP TABLE`) → commit → write files → remove the schema file → on a file failure restore what was written and throw. Both `try {} catch {}` blocks are deleted; the embeddings tolerance becomes an explicit existence check. `dev.js` shrinks to gathering inputs and calling it.
- [ ] **Step 6: Verify** — `node test.js`; every `LIFE-*` clause still green; `nexus dev` entity delete still works end to end by hand.

---

### Task 8: The job timeout stops leaking, and the two constants stop being equal (I6)

**Files:** Modify `src/core/Threads.js`, `src/core/App/jobthread.js` · Test `test/core/thread-cancel.test.js`, `test/app/job-timeout.test.js` (create; register in `test.js`)

**Interfaces produced:** `threads.cancel(queue)` → `boolean`.

- [ ] **Step 1: Clause (RED)** — `THR-CANCEL-01`: `cancel(queue)` removes the entry and reports whether one existed; cancelling twice is safe; a late reply for a cancelled queue is dropped without throwing.
- [ ] **Step 2: Clause (RED)** — `JOB-TIMEOUT-01`: a handler that never answers leaves `threads.queues` **empty** after the timeout, and the worker recycled (so the hung handler's side effect cannot fire after main settled the job).
- [ ] **Step 3: Clause (RED)** — `JOB-TIMEOUT-02`: `EXEC_TIMEOUT_MS < LEASE_MS` — pin the inequality, not the numbers.
- [ ] **Step 4: Implement** — add `cancel(queue)` to `Threads`; `execute()` captures the queue id from `threads.queue(...)`, and on timeout cancels it and recycles the worker (`terminate` + `register`); derive `EXEC_TIMEOUT_MS` from `LEASE_MS` in one place so they cannot drift.
- [ ] **Step 5: Verify** — `node test.js`; every `THR-*`, `JOB-*`, `JOBL-*`, `WH-*`, `MAIL-*`, `NOTIF-*` clause still green.

---

### Task 9: Tell the truth in the docs

**Files:** Modify `STATUS.md`, `ARCHITECTURE.md`

- [ ] **Step 1** — STATUS: move I6, I7, I8, I9, I11, TOCTOU and WAL out of "Unfinished" into a **Durability & atomicity** row with their clause ids. Do not inflate: say exactly what each fix does.
- [ ] **Step 2** — STATUS: record the three things this chunk does **not** close, plainly — the pooled-connection unsoundness remains reachable by any caller that still hand-rolls `run("BEGIN")` (§1's honest boundary); `hotApply` on MySQL is non-atomic by declaration (§5); Studio schema editing in production stays closed because the hot-reload-under-load half is untouched (§4).
- [ ] **Step 3** — STATUS: record the after-hook behaviour change as a behaviour change (N3), with the `before:` migration path in one line.
- [ ] **Step 4** — STATUS: refresh the headline clause count and note that the §0 pooled-transaction finding was **new** in this chunk — not from the audit — and would not have been caught by a live-Postgres test, since PGlite is single-connection.
- [ ] **Step 5** — ARCHITECTURE §4.5: add the transaction seam to the adapter contract description, since the executor contract is architecture, not an implementation detail.
- [ ] **Step 6: Verify** — full `node test.js` from a clean checkout of the branch; record the final count.

---

## Definition of done

- 0 red. Green count ≥ 623 + the new clauses. Skip count not increased.
- `node test.js` green on Linux; the live-engine matrix (sqlite, turso, PGlite) green.
- `nexus dev` entity delete, `nexus migrate`, and a hot schema apply all exercised by hand once, since Task 7 moves live code.
- STATUS.md carries no claim this branch did not earn.
