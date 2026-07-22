# `nexus dev`: what a hot reload leaves behind, and what a signal does — design

**Date:** 2026-07-22
**Source:** two gaps `dev.js` discloses in its own comments —
*"The old sqlite handle is left to the GC — a dev-only cost, taken deliberately for restartless entity CRUD"* and
*"No SIGINT/SIGTERM teardown exists in dev.js today (unlike start.js) — the watcher's lifetime is the process's; the spawned dev process is SIGKILLed by callers/tests, which reaps it along with everything else."*

**Baseline:** 752/802 node · 50/50 browser · 9/9 e2e · 0 red.

**The sentence this chunk is accountable to:** *a reload releases the instance it replaced, and a signal closes the database rather than abandoning it.*

---

## 0. Both comments understate their own defect

**"Left to the GC" is not what happens.** The handle is not garbage — `openInstanceData` opens it inside `buildInstanceApi`, which never returns it, so nothing outside the function ever holds a reference *or* a way to close it. The closure that does hold it stays alive as long as the `plane` built from it. It is not waiting to be collected; it is retained and unreachable.

Measured on this machine, counting file descriptors on the database in `/proc/<pid>/fd` while driving `POST /_studio/model`:

```
after boot: 3
after reload 1: 5     after reload 4: 13
after reload 2: 7     after reload 5: 17
after reload 3: 9
```

Not a constant per reload either — it tracks the growing table set. A dev session spent in the schema designer walks toward the descriptor limit, and every one of those connections holds live WAL state on the same file.

**"SIGKILLed by callers/tests, which reaps it" describes the test harness, not the user.** A developer presses Ctrl+C. Measured: the process dies by signal (`signal=SIGTERM`, no exit code) with the write-ahead log un-checkpointed — `data.db-wal` and `data.db-shm` still on disk. `start.js` already handles both signals; `dev.js` inherited nothing from it.

The reasoning in both comments is the same shape: a cost was judged acceptable *for dev*, and the judgement was never priced. This chunk prices it.

## 1. A built instance can be closed

`buildInstanceApi` returns a `close()` alongside `api`/`plane`/`effects`. It closes the executor (every engine already implements `close()` — sqlite/turso close the database, pg/mysql end the pool) and is idempotent: teardown paths overlap, and a second close must be a no-op rather than a throw.

Nothing else changes about the bundle. This is the missing half of a constructor that had no destructor.

## 2. A reload builds first, then releases

The current order is: stop the old effects → load → build the new bundle. That order has a second defect the leak was hiding. If the rebuild throws — a malformed model file dropped into `apps/` is enough — the watcher catches it and logs, but the old instance has **already had its effects stopped**. Dev keeps serving with a plane whose job runner is dead, and nothing says so.

The order becomes: build the new bundle → swap the bindings → stop and close the OLD one. A rebuild that throws now leaves the previous instance completely untouched, still serving, still running its effects.

Two connections to the same sqlite file exist briefly during the swap. That is exactly what WAL is for, and it is bounded by the rebuild.

## 3. A signal closes what the process opened

`dev.js` gets the teardown `start.js` has, plus what `start.js` is also missing:

1. stop the effect runner,
2. end every dev SSE subscriber (an EventSource left hanging makes the browser reconnect to a dead port),
3. close the watcher,
4. **close the data handle** — this is the step `start.js` lacks too, and it is what checkpoints the WAL,
5. close the server, exit 0.

Idempotent, because a second Ctrl+C while the first teardown is in flight must not start a second one.

## 4. Clauses

| Clause | Pins |
|---|---|
| `DEVFD-01` | descriptors on the database do NOT grow across repeated hot reloads (driven by `/proc`, and it says so when it cannot be) |
| `DEVFD-02` | a rebuild that THROWS leaves the previous instance serving, with its effects still running |
| `DEVDOWN-01` | SIGTERM exits `nexus dev` with code 0, not by signal |
| `DEVDOWN-02` | after that exit the write-ahead log is checkpointed away, not abandoned |
| `DEVDOWN-03` | teardown is idempotent — a second signal during shutdown does not re-run it |
| `STARTDOWN-01` | `nexus start` closes its data handle on SIGTERM too — the same gap, in production |
