# Test-suite Integrity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** close the three ways the test harness can report success while asserting nothing (issue #9): an all-skipped run reading green, the Sync stub answering for a module that failed to import, and a crashed ZSYNC harness degrading to a silent skip.

**Architecture:** two changes to the runner's verdict logic (`src/core/Test.js`) and two test-loading shims (`test/sync/_load.js`, `test/sync/zen-transport.test.js`). No change to what any existing clause asserts. The harness cannot fully test itself in one run, so clauses call `Test.run()` directly or drive a subprocess and inspect returned counts + exit code.

**Tech Stack:** Node ESM zero-dep kernel; the repo's own micro test runner (`src/core/Test.js`); `node test.js` full suite.

**Spec:** `docs/superpowers/specs/2026-07-21-test-integrity-design.md` · **Issue:** #9

## Global Constraints

- Spec-first TDD: every clause RED before its fix. Baseline: 593 green / 0 red / 53 skipped on this branch's base (main @ b638ee4). End state 0 red.
- A green verdict must mean assertions executed and held. "Ran nothing" (zero passes) is never green.
- Do not change what any existing clause asserts; do not implement the `{browser:true}` clauses; no assertion-counting-as-failure (out of scope, false-positives on no-throw tests).
- Zero runtime dependencies. Node ESM. Match `Test.js`'s existing style.
- Commit style: repo sentence style; every commit ends with `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`.

---

### Task 1: An all-skipped / zero-passed run is a failure (H1)

**Files:** Modify `src/core/Test.js` · Test `test/core/test-runner.test.js` (create; register in `test.js`)

**Interfaces produced:** `Test.run()` keeps returning `{ passed, failed, skipped, total, suites }` (unchanged). The change is the Node-only verdict: `process.exitCode` becomes 1 when `failed > 0` **OR** `passed === 0`, and the printed summary distinguishes the zero-passed case.

- [ ] **Step 1: Clause (RED)** — a suite of only-skipped tests must be treated as a failure. Because the harness sets a process-global `exitCode`, test it by driving `Test.run()` on a fresh in-memory suite and asserting on the returned counts plus a small exported helper for the verdict. Add a pure helper to `Test.js` so the rule is testable without reading `process.exitCode`:

```js
// in Test.js — the single source of the pass/fail rule, testable directly
export const isGreen = (r) => r.failed === 0 && r.passed > 0
```

Then the clause:

```js
    Test.it("RUN-01 a run that passed zero tests is not green, even with zero failures", () => {
        assert.equal(isGreen({ passed: 0, failed: 0, skipped: 5, total: 5 }), false, "all-skipped is not success")
        assert.equal(isGreen({ passed: 0, failed: 0, skipped: 0, total: 0 }), false, "no tests registered is not success")
        assert.equal(isGreen({ passed: 3, failed: 0, skipped: 2, total: 5 }), true, "real passes with some skips is green")
        assert.equal(isGreen({ passed: 3, failed: 1, skipped: 0, total: 4 }), false, "any failure is not green")
    })
```

- [ ] **Step 2: RED** — `node test.js`: RUN-01 fails (`isGreen` missing → import-time error; note this per Node ESM, then it asserts once defined).
- [ ] **Step 3: Implement** — add `isGreen`; route both the summary print and the exit code through it:

```js
        if (isGreen(results))
            console.log("\n" + LINE + "\n" +
                GREEN(`  All ${results.passed} tests passed`) +
                (results.skipped ? DIM(` (${results.skipped} skipped)`) : "") + "\n" + LINE)
        else if (results.failed > 0)
            console.log(/* existing failed summary */)
        else
            // zero passes, zero failures — nothing was verified
            console.log("\n" + LINE + "\n" +
                RED(`  No tests passed`) + DIM(` — ${results.skipped} skipped, 0 ran`) +
                DIM(" (a run that verifies nothing is not success)") + "\n" + LINE)

        if (NODE && !isGreen(results)) process.exitCode = 1
```

Read the actual current summary block and preserve the failed-case output verbatim; only add the zero-passed branch and widen the exit condition. Keep the browser path (no `process` there) working — guard the `exitCode` line with `NODE`.

- [ ] **Step 4: GREEN** — `node test.js`: RUN-01 green; the FULL run still ends green (593 passes ⇒ `isGreen` true ⇒ exit 0). Confirm the full run's exit code is still 0.
- [ ] **Step 5: Prove it discriminates** — run a single skipped-only suite (`node -e` importing Test, registering one `{skip:true}` test, calling `run()`), and show `isGreen` is false / exitCode 1. Paste the evidence.
- [ ] **Step 6: Commit**

```bash
git add src/core/Test.js test/core/test-runner.test.js test.js
git commit -m "A run that passes zero tests is not green — all-skipped no longer reads as success (RUN-01)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 2: The Sync stub answers only for an absent module, never a broken one (H2)

**Files:** Modify `test/sync/_load.js` · Test `test/sync/load-integrity.test.js` (create; register in `test.js`)

**Interfaces produced:** `_load.js` still `export default Sync`. New behavior: the `NOT_IMPLEMENTED` Proxy is returned **only** when `src/core/Sync.js` does not exist on disk; when it exists, its import error propagates unswallowed.

- [ ] **Step 1: Clause (RED)** — drive the load logic against a temp file. Because `_load.js` hardcodes the Sync path, factor the decision into a testable pure-ish function it exports:

```js
// _load.js exports the resolver so a clause can drive it with an arbitrary path
export async function loadSync(url, exists) {
    if (!exists) return new Proxy({}, { get: (_, p) => (p === "then" ? undefined : NOT_IMPLEMENTED) })
    return await import(url)   // present-but-broken must throw, not fall back
}
```

Clause (`test/sync/load-integrity.test.js`):

```js
    Test.it("SYNCLOAD-01 a present-but-broken Sync module surfaces its import error; an absent one yields the stub", async () => {
        const broken = /* write a temp .js that throws on import */ 
        await Test.assert.rejects(loadSync(pathToFileURL(broken).href, true), /* the real error, NOT NOT_IMPLEMENTED */)
        const stub = await loadSync("file:///does-not-exist.js", false)
        Test.assert.throws(() => stub.anything(), "NOT_IMPLEMENTED")
    })
```

Use the repo's existing tmp-file idiom (see `test/http/start.test.js`'s `mkdtempSync`). Assert the rejected error message is the temp module's own throw, and specifically is NOT `NOT_IMPLEMENTED`.

- [ ] **Step 2: RED** — the clause fails against the current `try/catch`-swallow `_load.js`.
- [ ] **Step 3: Implement** — rewrite `_load.js` to check `existsSync(fileURLToPath(new URL("../../src/core/Sync.js", import.meta.url)))`; when present, `await import(...)` with no catch (or catch-and-rethrow); when absent, the stub. Keep the Phase-0 docstring, updated to state the present-vs-absent distinction. The default export must still resolve for the existing SYNC-* suite (Sync.js is absent today, so the stub still ships — confirm the SYNC-* clauses stay exactly as green/red as before).
- [ ] **Step 4: GREEN** — `node test.js`: SYNCLOAD-01 green; the SYNC-* suite's pass/skip/red accounting is unchanged from baseline (state the before/after numbers).
- [ ] **Step 5: Commit**

```bash
git add test/sync/_load.js test/sync/load-integrity.test.js test.js
git commit -m "The Sync stub stands in only for an absent module — a broken one now surfaces its import error (SYNCLOAD-01)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 3: A ZSYNC harness with no verdict is a visible skip, not a silent browser-only one (H3)

**Files:** Modify `test/sync/zen-transport.test.js` · Test: extend `test/sync/load-integrity.test.js` or inline reasoning (UI-free; assert on the registration shape)

**Interfaces produced:** the no-verdict branch registers a skip via the runner's explicit skip mechanism with a reason, not `{ browser: true }`; the test name carries no interpolated error text (the reason/`console.warn` does).

- [ ] **Step 1: Read** `test/sync/zen-transport.test.js` and `src/core/Test.js`'s skip handling — find the explicit skip opt (`{ skip: true }` or the equivalent the runner honors at `Test.js`'s skip branch) and how a skip reason is carried and printed.
- [ ] **Step 2: Implement** — in the `if (!verdict)` branch: replace `Test.it(\`ZSYNC-00 skipped — ...: ${spawnError}\`, () => {}, { browser: true })` with a fixed-name skipped test (`ZSYNC-00 the mesh harness did not run`) registered via the explicit skip mechanism, carrying `spawnError` as the skip reason (or a `console.warn`), NOT in the name. Leave the `verdict.error` assertion path (harness ran and errored ⇒ real failure) untouched. Add a short comment: harness-unavailable is a legitimate skip; a harness that ran and errored fails ZSYNC-00; neither is a browser concern.
- [ ] **Step 3: Verify** — `node --check` the file; `node test.js` green; confirm the ZSYNC suite still behaves (harness available ⇒ real assertions; unavailable ⇒ one visible skip with a reason, no error text in the name). Because H1 (Task 1) now makes an all-skipped run non-green, confirm a filtered `node test.js` of only an unavailable ZSYNC still behaves sensibly (documented: it is non-green because nothing was verified — the honest outcome).
- [ ] **Step 4: Commit**

```bash
git add test/sync/zen-transport.test.js test/sync/load-integrity.test.js
git commit -m "A ZSYNC harness with no verdict is a visible skip with its reason, not a silent browser-only stub (H3)

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

---

### Task 4: STATUS records the harness-integrity fixes

**Files:** Modify `STATUS.md`

- [ ] **Step 1:** add a short honest note that the runner now fails a zero-passed run, the Sync stub no longer masks a broken module, and a crashed ZSYNC harness is a visible skip — with the clause IDs (`RUN-01`, `SYNCLOAD-01`, `H3`). Remove the "Test.js all-skipped-reports-green hazard" from any known-issues/deferred list it appears on (it is now fixed). Match STATUS's voice.
- [ ] **Step 2:** `node test.js` — full suite green, exit 0, count = 593 + the new clauses. Paste the summary line.
- [ ] **Step 3: Commit**

```bash
git add STATUS.md
git commit -m "STATUS: the test runner can no longer report green on a run that verified nothing

Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```
