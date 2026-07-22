# One instance, one thread namespace — design

**Date:** 2026-07-22
**Source:** issue #36 — *the job runner is dead after every hot reload*, and the one-line fix that trades it for a descriptor leak.

**Baseline:** 768/819 node · 50/50 browser · 9/9 e2e · 1 red (`JOB-TIMEOUT-03`, in scope here).

**The sentence this chunk is accountable to:** *an instance owns its threads, and releasing one instance cannot touch another's.*

---

## 0. What is actually wrong

`Threads` is a module-level singleton whose threads are keyed by NAME, and `register()` is a get-or-create:

```js
async register(name, configs = {}) {
    if (this.threads[name]) return this.threads[name]
```

`startJobThread` registers under the constant `"job"`. `bindPlaneRpc` binds the main-side pseudo-thread under the constant `"plane"`. So the name is the identity, and **two instances cannot both exist** — but `nexus dev` deliberately makes them, briefly, on every hot reload: the rebuild happens before the old instance is released, so a rebuild that throws leaves the server serving.

The consequences follow mechanically:

1. The new instance's `startJobThread` is handed the **old worker** — old apps, old config, `workerData` it never asked for.
2. The old instance's `effects.stop()` then terminates that worker.
3. The new instance is left with **no worker at all**, and nothing says so.

Measured end to end: a job enqueued before a reload completes; the next one after it sits in `running` forever.

**The obvious fix is worse.** Stopping the old runner before the rebuild frees the name, and the runner works — but then every reload really does spawn a new worker, and those are not fully reclaimed. Descriptors on the database over 24 reloads: flat at 5 on `main`, 28 with that fix. `main` is flat *because of the bug*, since no new worker is ever created. That is also why `DEVFD-01`'s threshold had to be widened twice: the reading was climbing because something was.

So the leak is not a second, unrelated defect. It is the same one seen from the other side: **worker lifetime is not tied to instance lifetime**, because the registry cannot tell two instances apart.

## 1. The names come from inside, not from callers

`startJobThread` mints its own name. `bindPlaneRpc` mints its own and returns it. Neither asks a caller to invent one, because a caller that forgets makes exactly the bug we are fixing, silently.

```js
const { planeName } = bindPlaneRpc(plane, ctx)      // → "plane#a1b2c3d4"
const jobThread = await startJobThread({ …, planeName })  // → registers "job#e5f6a7b8"
```

The worker learns its plane's name through `workerData` and uses it in `rpc()` instead of the constant it hardcoded. That is the one place a name still has to cross a boundary, and it is the place the previous attempt got wrong by changing only one of the two ends.

`stop()` deletes both — the worker it registered and the plane it was bound to — so an instance released takes exactly its own threads with it and nothing else's.

## 2. What this does NOT do

**It does not make `Threads` instance-aware.** The registry stays a flat name map. Making it hierarchical would be a bigger change to a module the browser also loads, and the flat map is sufficient once names are unique: uniqueness is the property that was missing, not structure.

**It does not change the reload order.** The build-first ordering stays, and with unique names it is finally correct rather than accidentally survivable.

## 3. The startup budget, which is the same defect wearing a different code

`execute` starts its timeout when it hands the job over. A worker still importing its module graph and every app's `hooks.js` therefore spends the **handler's** budget booting, and reports `E_TIMEOUT` — which reads as *your handler hung*. After a recycle that is the common case, and the job that pays is an innocent one; its timeout recycles the worker again, so the next job is likely to do the same. One hung handler can walk a queue of healthy jobs into the dead-letter queue, burning an attempt each time.

This belongs here because it only becomes reachable once workers are really being created per instance. It gets:

- a **separate budget** (`startupMs`), not the handler's,
- a **separate code** (`E_THREAD_START`), because "the worker never came up" and "your handler hung" are different facts,
- **lazy confirmation** — the readiness round-trip happens inside the call that needs it, never parked on the queue between jobs, because an idle entry on the queue reads exactly like the abandoned one `JOB-TIMEOUT-01` exists to catch. (Found the hard way: an eager ping made that clause fail.)

## 4. Clauses

| Clause | Pins |
|---|---|
| `THRNS-01` | two live `startJobThread`s hold two DIFFERENT workers, and stopping one leaves the other working |
| `THRNS-02` | `bindPlaneRpc` returns the name it bound, and two bindings do not overwrite each other |
| `THRNS-03` | `stop()` removes its own worker AND its own plane binding, and nothing else's |
| `DEVFD-03` | the job runner survives a hot reload — driven end to end, since a runner is not something a status endpoint reports |
| `DEVFD-01` | descriptors do not grow across reloads — the same clause, now measuring a fix rather than a bug |
| `JOB-TIMEOUT-04` | a worker that cannot come up says `E_THREAD_START`, not a hung handler's code |
| `JOB-TIMEOUT-01` | (unchanged) no queue entry is left parked between jobs — the constraint that makes confirmation lazy |
