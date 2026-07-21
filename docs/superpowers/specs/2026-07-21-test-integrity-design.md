# Test-suite integrity — design

**Date:** 2026-07-21
**Issue:** #9 (audit follow-up), the "Runner hazard worth fixing on its own" + the "Structurally weak" coverage-map findings.
**Scope:** the test *harness's own* honesty. This is chunk 1 of the #9 non-Linux follow-up and it comes first deliberately: every other #9 fix lands clause-first, and a clause is only worth its ability to fail. Three known ways the current harness can report success while asserting nothing must be closed before the correctness fixes (I6–I9, I11) rely on new clauses.

**The lesson driving this:** the audit found five Criticals in a tree that was 540 green. Green proved the clauses passed, not that the system was safe. Same principle one level down: a runner that exits 0 when nothing ran, or a stub that answers for a module that failed to load, is a green light wired to nothing.

## The three holes

### H1 — an all-skipped (or zero-passed) run reports green and exits 0
`src/core/Test.js` prints `All ${passed} tests passed` whenever `failed === 0`, and sets `process.exitCode = 1` only when `failed > 0`. So a run where **every** test skipped — or where a suite failed to load and registered zero tests, or a filter matched nothing — prints green and exits 0. CI cannot tell "everything passed" from "nothing ran."

**Fix:** a run is a failure (`exitCode = 1`, loud message) when it executed **zero passing tests** — `passed === 0` — regardless of `failed`/`skipped`. "Ran nothing" is not "all good." The message must name the reason (all skipped / no tests registered / filter matched nothing) rather than the misleading "All 0 tests passed."

**Edge to respect:** a deliberately-filtered run that legitimately has only browser-only tests under Node would now be non-green. That is correct — under Node those tests did not run, so that invocation proved nothing and should not read as success. A green result must mean assertions executed and held.

### H2 — the Sync stub answers for a module that exists but failed to import
`test/sync/_load.js` wraps `await import("../../src/core/Sync.js")` in a `try/catch`; on ANY failure it substitutes a `Proxy` whose every property throws `NOT_IMPLEMENTED`. The Phase-0 intent is legitimate: while `Sync.js` does not exist yet, the SYNC-* clauses run RED-by-design against the stub. The hole: once `Sync.js` **exists** but throws on import (a syntax error, a bad top-level import, a thrown module init), the same `catch` swallows the real error and installs the stub — so every "expected to reject with NOT_IMPLEMENTED" clause passes against nothing, and a genuinely broken Sync module reads as the expected not-yet-implemented state.

**Fix:** distinguish "the file is absent" (legitimate Phase-0 stub, RED by design) from "the file is present but failed to import" (a real error that must surface). Check for the file's existence explicitly; only fall back to the stub when it genuinely does not exist. When it exists, let the import error propagate — a broken module must fail loudly, not masquerade as unimplemented.

### H3 — a crashed ZSYNC harness degrades to a silent browser-only skip
`test/sync/zen-transport.test.js`, when the mesh harness produces no verdict, registers a single `ZSYNC-00 skipped — ...: ${spawnError}` test with an **empty body** and `{ browser: true }`. Under Node, `{ browser: true }` is skipped — so a harness that CRASHED (a real bug) is indistinguishable from a normal Node run and contributes no failure.

**The genuine tension:** the ZSYNC harness needs real ZEN peer-to-peer transport, which is legitimately unavailable in some environments (no network, sandboxed CI). "Unavailable" is a defensible skip; "ran and crashed" is not. The fix must keep the honest skip while refusing to hide a crash.

**Fix:** drop the `{ browser: true }` disguise on the no-verdict path (it is not a browser concern — it is a subprocess that did not produce output). Register the no-verdict case as a **visible skip with its reason**, not a silent one, so H1's zero-passed rule and the summary both surface it when it is the only thing in the suite. Keep the error text OUT of the test *name* (a name is an identifier, not a payload) and put it in the skip reason / a `console.warn`. Where the harness clearly *ran and errored* (a non-null verdict carrying `verdict.error`) the existing ZSYNC-00 assertion already fails correctly — leave that path.

## What this is NOT (scope discipline)

- **Not** blanket "a test that made zero `assert` calls fails." Many legitimate clauses assert only "does not throw" by running code with no explicit assertion; turning zero-assertions into a failure would false-positive across the existing 593. Assertion-counting is a larger, separate question and is out of scope here.
- **Not** implementing the 17 `{ browser: true }` clauses as real browser tests — they are honestly reported as skipped and belong to the manual-E2E / browser-runner track, not here.
- **Not** touching what any existing clause asserts. This changes the runner's *verdict logic* and two test-loading shims, never the meaning of a passing test.

## Error handling

Every new refusal is loud and specific: H1 names why the run had zero passes; H2 lets the real import error through unaltered; H3 states the harness-unavailable reason visibly. No new silent path is introduced — the whole point is removing silent ones.

## Testing

The harness cannot fully test itself in the same run, so these clauses drive the runner as a subprocess / by calling `run()` directly and inspecting its returned `{ passed, failed, skipped }` and exit code:

- **H1:** a suite containing only skipped tests, run through `Test.run()`, yields a result the harness treats as failure (exitCode 1); a suite with ≥1 pass and 0 fail stays green. Assert on the returned counts and the process exit signal, not on stdout scraping alone.
- **H2:** with a deliberately-broken temporary `Sync.js` (throws on import), `_load.js` must propagate the error rather than return the stub; with the file absent, it returns the stub as before. Prove both directions.
- **H3:** the no-verdict path registers a visible skip whose reason is present and whose test name contains no interpolated error text; a harness that returns `verdict.error` still fails ZSYNC-00.

## Out of scope (recorded for later chunks)

The correctness/atomicity fixes (I6, I7, I8, I9, I11), the black-box coverage clauses (server.js/api.js/dev.js/start.js), and the moderates (WAL/busy_timeout, SSE fan-out, TOCTOU, rate-limit/caps, fire() full-scan, search() inline re-embed cap, dev.js oversize-body hang) are separate chunks of the #9 follow-up.
