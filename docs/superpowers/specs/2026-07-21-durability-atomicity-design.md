# Durability & atomicity — design

**Date:** 2026-07-21
**Issue:** #9 (audit follow-up), chunk 2 — the correctness/robustness Importants left open after the security chunk: **I6** (Threads queue leak on job timeout), **I7** (writes not atomic with derived state or hooks), **I8** (entity delete is a non-atomic destructive sequence with swallowed errors), **I9** (`hotApply` multi-statement DDL with no transaction), **I11** (`after:remove` id leak), plus the two moderates that belong to the same theme: **TOCTOU on update/remove** and **no SQLite WAL/`busy_timeout`**.

**Baseline:** 623 green / 0 red / 46 skipped on `main` @ `164b455`, verified on Linux.

**The one sentence this chunk is accountable to:** *a write either fully happened or fully did not, and the system tells the caller the truth about which.*

Chunk 1 (test integrity) came first on purpose: every fix below lands clause-first, and a clause is only worth its ability to fail. That is now true, so the correctness work can rely on it.

---

## 0. The finding that reframes the whole chunk

The audit said I7/I8/I9 need "transaction boundaries". Reading the code to place them surfaced something the audit did not: **there is no transaction primitive to place them with, and the one place that improvises one is unsound on two of the four engines.**

The executor contract (`src/core/Data/executor.js`) is exactly `{ engine, dialect, run, all, close }`. The only transactional code in the tree — `applyMigration` (`src/core/Data/migrate.js:249,284,287`) — improvises by sending literal `BEGIN` / `COMMIT` / `ROLLBACK` strings through `run()`. On sqlite (one `DatabaseSync` handle) and PGlite (one in-process instance) that is correct, because every statement provably lands on the same connection.

On the **pooled** drivers it is not:

- `postgres` non-PGlite path builds a `pg` `Pool` and calls `pool.query(...)` per statement (`executor.js:132-138`). `pool.query()` checks out *an arbitrary idle client per call*.
- `mysql` builds a `mysql2` pool and does the same (`executor.js:145-151`).

So `BEGIN`, the DDL, and `COMMIT` can each land on a **different connection**. The `BEGIN` opens a transaction on a connection that then goes back to the pool and is never committed; the DDL runs outside any transaction on another; the `ROLLBACK` rolls back nothing. The structural migration path's headline guarantee — "executes everything inside one transaction, then rolls back" (`migrate.js:20-22`) — is therefore **false on a live pooled Postgres**, exactly as it was false on MySQL for the different reason C5 already closed.

This is invisible today because the live Postgres clauses (`LIVEPG-*`) run against **PGlite**, which is single-connection. The engine where the guarantee breaks is, again, the one the suite never exercises. That is the same shape as C5 and it is worth stating plainly rather than fixing quietly.

**Consequence for this chunk:** the first task is not I7. It is giving the executor a real transaction seam, because I7, I8, I9 and TOCTOU all need one and none of them can be honestly built on `run("BEGIN")`.

---

## 1. The transaction seam (foundation for I7/I8/I9/TOCTOU)

### Contract

The executor contract gains one optional-by-shape, always-present-in-practice method:

```js
executor.transaction(async (tx) => { … })   // tx = { run, all }
```

Rules, in the order they matter:

1. **One connection for the whole callback.** Pooled drivers check a client out, run the entire callback on it, and release it in a `finally`. This is the property that makes the method worth having at all; without it `transaction()` would be the same lie as `run("BEGIN")` with a nicer name.
2. **Commit on return, rollback on throw.** The callback's return value is the transaction's value. Any throw rolls back and re-throws the original error — never a rollback error masking it (a failed rollback is appended to the message, not substituted for it).
3. **No nesting in v1.** A `tx` handed to a callback has no `transaction()` of its own. Nested calls would need savepoints, whose syntax differs per engine; declaring "not in v1" is honest, whereas silently flattening would produce a transaction that commits half-way. A nested attempt throws `E_NESTED_TX`.
4. **`sqlite` uses `BEGIN IMMEDIATE`,** not bare `BEGIN`. SQLite's default deferred transaction takes its write lock at the first *write*, so a read-then-write transaction (which is exactly what `update`/`remove` are) can have another writer slip in between — a deferred transaction is not a TOCTOU fix. `BEGIN IMMEDIATE` takes the write lock up front. Turso follows the same SQL dialect and gets the same treatment.
5. **Capability-declared, not assumed.** `CAPABILITIES` (`src/core/Data/adapters.js`) gains `transactions: true` for all four engines — DML transactions are universal, and this is deliberately *separate* from the existing `transactionalDDL`, which stays `false` for MySQL. An engine added without a record still fails closed, as `capabilitiesFor` already guarantees.

### Where it lives

Real drivers live in `executor.js` (server-only, behind the browser boundary VND-07 pins). `adapters.js` stays declaration-only — it gains the capability flag and nothing else. No Node import moves.

### What it replaces

`applyMigration` stops improvising and calls `executor.transaction()`. Its behaviour on sqlite/PGlite is unchanged; on pooled Postgres it becomes true for the first time. The `transactionalDDL` refusal (`MIG-NOTX`, C5) is untouched and still runs first — MySQL never reaches the transaction at all on the structural path.

### Honest boundary

A caller holding a plain `executor` (an app, the CLI) can still call `run("BEGIN")` and get the old unsound behaviour on a pooled engine. This chunk does not — and cannot — remove that. What it does is make the *framework's own* write paths stop doing it, and give apps a correct primitive to use instead. Documented in STATUS, not papered over.

---

## 2. I7 — writes atomic with derived state; after-hooks contained

`Data.create` / `update` / `remove` currently run: write → embedding → `after:` hook, each awaited in sequence with no envelope. Two distinct failures hide in that:

**(a) Derived state can diverge from the row.** `#maintainEmbedding` throws (a model that failed to load, a full disk) *after* the INSERT committed. The caller gets a 500; the row is there; the embedding is not. The client believes the write failed and retries, producing a second row.

**(b) An after-hook failure is reported as a write failure.** `Extensions.run` awaits every hook and propagates a throw. An app's `after:create` that throws makes a durably-committed write look like a 500.

### The boundary this chunk draws

> **Inside the transaction: the row and everything derived from it. Outside and after commit: everything that reaches the world.**

Concretely:

- `before:` hooks run **before** the transaction opens. They may still mutate the payload and throw to veto — unchanged contract, and vetoing before anything is written is the correct place for it.
- The transaction contains: the permission pre-image read (`update`/`remove`), the INSERT/UPDATE/DELETE, and the embedding maintenance (`#maintainEmbedding` / `#dropEmbedding`). If the embedding throws, the row is rolled back and the caller's 500 is **true** — nothing happened, and a retry is correct.
- `after:` hooks run **after commit**, and a throwing after-hook **no longer fails the call**. The write is durable; telling the caller otherwise invites the duplicate-write retry described above.

### The behaviour change, stated plainly (N3)

An app whose `after:create` throws used to see the whole request fail. It now sees the write succeed. This is a deliberate, breaking-shaped change to an App API v1 surface, so it is handled the way N3 requires rather than slipped in:

- The failure is **not swallowed**. It is reported through a new `onHookError` sink on the `DataPlane` (default: `console.error` with entity, event and the error). The server wires it to the request log. A hook failure is loud in the operator's log and invisible to the caller — which is the same doctrine the event hub already runs under ("a hook failure never fails the write", WH-03), now applied consistently instead of only where someone remembered it.
- An app that genuinely needs to veto has the mechanism already: `before:`. That is what it is for. The migration path is one word.
- Recorded in STATUS as a behaviour change, not as a bugfix footnote.

### Scope note

`#currentVectors`' inline re-embedding on the *read* path (`search()`) is a resource bound, not an atomicity question. It stays in chunk 3 with the other resource bounds.

---

## 3. TOCTOU on update/remove — closed by construction, plus a belt

The audit's finding: the permission check runs as a `SELECT` with the permission filter injected, then the `UPDATE`/`DELETE` is keyed on `id` alone. Between the two, the row can change so that it no longer satisfies the rule the caller was authorized under.

Two fixes, both cheap, and both wanted:

1. **The read and the write are in one transaction** (§1) — on sqlite/turso with `BEGIN IMMEDIATE`, so no other writer interleaves.
2. **The permission filter is injected into the write statement too**, not only the pre-image `SELECT`. `UPDATE … WHERE id = ? AND <permission predicate>` and likewise for `DELETE`. If the write matches zero rows, the transaction rolls back and the caller gets the same `E_NOT_FOUND` it would have got had the pre-image read missed — no new error channel, no existence leak.

(2) is the one that survives a hostile scheduler on an engine with weaker isolation than SQLite's serialized writes, so both land. `applyWhere` and the compiled filter are already available at that point in `update`/`remove` — this is reuse, not new machinery.

---

## 4. I8 — entity delete: one transaction, no swallowed errors, and moved into core

`dev.js:277-297` performs the cascade as a bare sequence: policy rows → view rows → per-link (rewrite the schema **file**, then `ALTER TABLE … DROP COLUMN` inside `try {} catch {}`) → embeddings delete (`try {} catch {}`) → `DROP TABLE` → `rmSync` the schema file. No transaction, and two silent catches.

The worst ordering bug is the link drop: the schema file is rewritten to remove the field *before* the `DROP COLUMN` that may silently fail. When it does, the file says the field is gone and the table says it is not — a permanent, invisible schema/DB divergence that no later operation reconciles.

### Fix

**Move the executor into `src/core/App/lifecycle.js` as `applyEntityDelete({ plane, root, plan, fs })`,** beside the pure `entityDeletePlan` it performs. This is not tidying: `dev.js` is imported by no test (the coverage map says so), so the destructive path is currently untestable in-process. In `lifecycle.js` it is ordinary core code with ordinary clauses, and `dev.js` shrinks to gathering inputs and calling it — which is what its own comment already claims it does.

Then, inside it:

- **DDL + DML in ONE transaction**: policy row deletes, view row deletes, every `DROP COLUMN`, the embeddings delete, and the `DROP TABLE`. Requires `transactionalDDL`; on an engine without it the whole operation **refuses up front** with `E_NO_TRANSACTIONAL_DDL`, reusing the message and the shape C5 already established for the structural migration path. Refusing is right here: a half-cascaded delete is worse than a delete you must do another way.
- **No swallowed errors.** Both `try {} catch {}` blocks go. A `DROP COLUMN` that fails aborts the cascade and rolls it back. The one legitimate tolerance — the embeddings table not existing at all on an instance that never embedded anything — is expressed as `DELETE FROM … WHERE` guarded by an existence check, not by catching everything.
- **Files move only after the DB transaction commits.** Every new file body is computed *before* the transaction; the transaction commits; only then are files written and the schema file removed. If a file write fails after commit, already-written files are restored from the in-memory originals and the error surfaces — the DB is the authority and the files are reconciled to it, rather than the current arrangement where the files lead and the DB may silently not follow.

### Ordering, stated once

```
compute plan → compute new file bodies (in memory)
  → BEGIN → policies → views → DROP COLUMNs → embeddings → DROP TABLE → COMMIT
    → write files → remove schema file
      → on file failure: restore written files, throw
```

### What this unblocks

STATUS currently defers Studio schema editing in production because it "needs hot-reload-under-load and a transactional entity-delete first (issue #9's I8, still open)". This closes the entity-delete half. Opening the production route is **not** in this chunk — the hot-reload half is untouched, and PROD-02's latent direction stays latent. Stated so the next chunk knows exactly what remains.

---

## 5. I9 — `hotApply` inside a transaction where the engine can, declared where it cannot

`hotApply` (`migrate.js:146-152`) loops compiled DDL statements with no envelope. A failure partway (statement 2 of 3) leaves the table between states with no ledger entry.

**Fix, and the deliberate asymmetry with §4:**

- Where `transactionalDDL` is true (sqlite, turso, postgres): the statement loop runs inside `executor.transaction()`. Partial application becomes impossible.
- Where it is false (mysql): `hotApply` **still runs**, statement by statement, and its return value gains `atomic: false`.

Refusing on MySQL — the §4 choice — would be wrong here, and the difference is worth naming rather than looking inconsistent. Entity delete is *destructive*: a half-done cascade loses data, so refusing costs the operator a different route and nothing else. Hot apply is *additive* (add nullable column, add index — that is the entire hot set by construction, `plan()` defers everything else): a half-done additive change loses nothing, and refusing would mean MySQL instances cannot add a field at all. So the honest answer is to do the work and report the weaker guarantee, not to hide it and not to withdraw the feature.

`{ applied, statements, atomic }` is a widened return, not a changed one — additive under N3. Callers that ignore it are unaffected; the Studio surfaces it so an operator on MySQL sees the truth.

---

## 6. I11 — `after:remove` stops leaking ids past the row rule

`Data.remove` reads only `["id"]` for its pre-image, so by the time `after:remove` fires the row is gone and nothing about it survives. The event hub therefore falls back to a **document-level** check (`events.js:39-43`): `Permission.resolve(...).allowed`, which is true whenever *any* permlevel-0 read policy applies — the row-restricting `rule`/`ifOwner` survive only in the discarded `filter`.

Result: any subscriber with document-level read on an entity learns the id of **every** removed row of that entity, regardless of row-level restrictions. In a multi-tenant instance that is a cross-tenant identifier feed.

**Fix — the `before:remove` capture the STATUS note already names as the closing move:**

- `remove()` reads the **full** pre-image inside its transaction (it is already doing a `SELECT`; widening the projection costs nothing) and passes it as `row` on both the `before:remove` and `after:remove` payloads.
- `events.js`'s `visible()` for a `remove` event evaluates the row rule against that captured row — `resolve().allowed && (filter === null || AST.predicate(filter)(row))` — instead of stopping at `allowed`. Same containment doctrine: `visible()` still cannot throw, and a missing row (a hook fired without one) resolves to **deny**, not to the old permissive fallback.
- **No row data reaches the wire.** The payload stays `{ entity, event, id, ts }`. The captured row is used to *decide*, never to *send*. This is worth pinning as its own clause, because a fix that closed an id leak by shipping the row would be a worse bug than the one it closed.

`after:remove` receiving `{ id, row }` instead of `{ id }` is additive on an App API v1 payload — existing hooks reading `payload.id` are unaffected.

---

## 7. I6 — the job-timeout leak, and the two constants that must move together

`startJobThread`'s `execute()` (`jobthread.js:40-46`) rejects on a timer but leaves the `threads.queues` entry in place forever and never stops the worker. Three consequences, in ascending severity:

1. The map entry leaks per timed-out job.
2. The worker keeps running the hung handler. Its side effect still fires — after main has already settled the job as failed and scheduled a retry. That is an at-least-once pipeline turning into an uncontrolled-concurrency one.
3. `EXEC_TIMEOUT_MS` (60000) **equals** `LEASE_MS` (60000). At equality there is no window in which the runner has given up but the lease has not expired, so another runner can claim the job at the same instant the first is still inside it.

**Fix:**

- `Threads` gains `cancel(queue)` — deletes the entry and returns whether one existed. Small, symmetrical with `queue()` (which already returns the queue id), and it is the missing half of the existing API rather than a new concept.
- `execute()` captures the queue id, and on timeout `cancel(queue)`s it **and recycles the worker** (`terminate` + `register`). Recycling is the only way to actually stop a hung handler — v1's pool is fixed at one thread, so this is a bounded, well-defined operation. Without it, fix (1) alone would reclaim the memory and leave the real problem, which is (2).
- `EXEC_TIMEOUT_MS` becomes strictly less than `LEASE_MS`, derived from it in one place rather than restated, so the two cannot drift apart in a later edit. A clause pins the inequality directly — that is the invariant, not the specific numbers.

---

## 8. SQLite WAL + `busy_timeout`

Not cosmetic here, and it is in this chunk rather than the resource-bounds chunk for a specific reason: §1 through §5 put **more** work inside write transactions and hold write locks for longer. With the 1s job poller, HTTP writes and per-subscriber `plane.get` all on one file, the default rollback journal turns that into `SQLITE_BUSY` surfacing as a raw 500. Landing the transactions without this would make a correctness fix read as a regression.

- `PRAGMA journal_mode = WAL` for **file-backed** sqlite databases only. `:memory:` does not support WAL and must not be asked for it.
- `PRAGMA busy_timeout = 5000`, overridable via config.
- Both applied at executor construction, both reported by `nexus doctor` so an operator can see what the engine is actually running under.

---

## 9. What this chunk is NOT

- **Not** rate limiting, connection caps, subscriber caps, backup streaming, SSE fan-out parallelism, `fire()`'s full scan per write, or `search()`'s inline re-embed cap. Those are one coherent *resource-bounds* chunk and mixing them in would make both harder to review. Deferred, explicitly, to chunk 3.
- **Not** opening Studio schema editing in production (§4).
- **Not** the in-process HTTP coverage clauses for `server.js`/`api.js`/`start.js` — chunk 4. §4's move of the delete executor into core is the exception and it is a means, not the goal: the code had to move to be testable at all.
- **Not** savepoints / nested transactions (§1 rule 3).
- **Not** exactly-once job semantics. §7 narrows a concurrency window; at-least-once remains the declared contract and consumers must remain idempotent.

## 10. Error handling

Every refusal added is loud, specific and typed: `E_NESTED_TX`, `E_NO_TRANSACTIONAL_DDL` (reused verbatim from C5). Every silent catch removed is replaced by an error that propagates, except the one narrowed tolerance in §4 which becomes an explicit existence check. The single place where an error is deliberately *not* propagated to the caller — the after-hook sink in §2 — routes to `onHookError` and the operator log, and is declared in STATUS. No new silent path is introduced.

## 11. Testing

Every clause below is written RED first.

| Area | Clause | Asserts |
|---|---|---|
| §1 | `TXN-01` | `transaction()` commits on return, rolls back on throw, re-throws the original error |
| §1 | `TXN-02` | a pooled driver runs the whole callback on ONE connection (driven with a fake pool that hands out distinguishable clients — the finding in §0 made concrete) |
| §1 | `TXN-03` | nested `transaction()` throws `E_NESTED_TX` |
| §1 | `TXN-04` | sqlite/turso open with `BEGIN IMMEDIATE` |
| §1 | `ADP-TXN` | `CAPABILITIES` declares `transactions` for every engine; unknown engines still fail closed |
| §2 | `DPL-ATOMIC-01` | an embedder that throws leaves NO row behind on create, and the pre-image intact on update |
| §2 | `DPL-ATOMIC-02` | a throwing `after:` hook does not fail the write, and the row is durable |
| §2 | `DPL-ATOMIC-03` | that failure reaches `onHookError` with entity + event — contained, not swallowed |
| §2 | `DPL-ATOMIC-04` | a throwing `before:` hook still vetoes and leaves no row |
| §3 | `DPL-TOCTOU-01` | the UPDATE/DELETE statement itself carries the permission predicate; a row moved out of scope between read and write is not written and reports `E_NOT_FOUND` |
| §4 | `LIFE-TX-01` | a `DROP COLUMN` failure mid-cascade rolls back policies, views and rows — nothing is left half-deleted |
| §4 | `LIFE-TX-02` | schema files are untouched when the DB transaction fails |
| §4 | `LIFE-TX-03` | a non-transactional-DDL engine refuses with `E_NO_TRANSACTIONAL_DDL` before any statement runs |
| §4 | `LIFE-TX-04` | the happy path still performs EXACTLY what the plan named, nothing more |
| §5 | `MIG-HOTTX-01` | a failing second statement leaves the table in its pre-apply state on a transactional engine |
| §5 | `MIG-HOTTX-02` | `atomic: false` is returned, and the work still done, on a non-transactional-DDL engine |
| §6 | `EVT-ROWGATE-01` | a subscriber with document-level read but a row rule that excludes the removed row does NOT receive the remove event |
| §6 | `EVT-ROWGATE-02` | a subscriber the row rule DOES match still receives it (the fix narrows, it does not blind) |
| §6 | `EVT-ROWGATE-03` | the emitted frame still carries only `{entity,event,id,ts}` — no row data on the wire |
| §6 | `EVT-ROWGATE-04` | an event arriving with no captured row denies rather than falling back to permissive |
| §7 | `THR-CANCEL-01` | `cancel(queue)` removes the entry and reports whether one existed |
| §7 | `JOB-TIMEOUT-01` | a handler that never answers leaves `threads.queues` empty and the worker recycled |
| §7 | `JOB-TIMEOUT-02` | `EXEC_TIMEOUT_MS < LEASE_MS` — the invariant, not the numbers |
| §8 | `ADP-WAL-01` | a file-backed sqlite executor reports `journal_mode=wal` and the configured `busy_timeout`; `:memory:` is never asked for WAL |

The multi-engine matrix runs `TXN-*` on sqlite, turso and PGlite. The pooled-connection clause (`TXN-02`) is driven with a fake pool, because that is what makes it provable *without* a live cluster — the §0 finding is exactly the kind that a live-only test would have kept invisible.

## 12. Out of scope, recorded

Chunk 3 (resource bounds): rate limiting, connection/subscriber caps, backup streaming, SSE fan-out parallelism, `fire()` full-scan, `search()` inline re-embed cap, `dev.js` oversize-body hang.
Chunk 4 (coverage): in-process clauses for `server.js`, `api.js`, `start.js`.
Issue #8 (lifecycle) remains decisions-first and untouched here.
