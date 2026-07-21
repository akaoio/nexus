# In-process HTTP coverage — design

**Date:** 2026-07-21
**Issue:** #9 (audit follow-up), chunk 4 — the last of it. The coverage map's first list: *"Never imported by any test (black-box subprocess observation only): `src/core/HTTP/server.js` (the auth seam, `context()`, policy composition, JOB_CTX) · `src/core/HTTP/api.js` (routing, the `?token=` fold, body limits) · `src/cli/commands/dev.js` · `src/cli/commands/start.js`."*

**Baseline:** 682/728 green / 0 red / 46 skipped on `worktree-resource-bounds`.

**The sentence this chunk is accountable to:** *the auth seam is exercised in-process, so a change to it fails a clause instead of a deployment.*

---

## 0. Why this is the right last chunk, and what it is really about

Three of issue #9's five Criticals lived in these files. C1 (any user can make themselves admin) turned on how `context()` composes policies. C1b (`/_auth/verify` accepts an unprovisioned pub) turned on what "authenticated" means there. I4 (no revocation) turned on where roles come from. All three were found by a human reading the code, and none could have been caught by a clause, because **no test imports these modules**. The suite observed them only through spawned subprocesses over real sockets.

Subprocess tests are not worthless — `START-*` and `STUDIO-*` prove real HTTP end to end, and they should stay. But they are expensive, so there are few of them; they assert on status codes, so they see the outside of a decision and not the decision; and they cannot reach a branch that needs a specific directory state without building a whole instance to get there. That combination is exactly why a permission-composition bug survives.

So this chunk is not "raise a coverage number". It is: **make the auth decision itself assertable**, cheaply enough that the next change to it is covered by default.

## 1. The seam that makes it possible, and why nothing needs to be added

`createApi` returns `async handle(req, res)` — a plain function over two duck-typed objects. `buildInstanceApi` returns that handle as `api`. Nothing about either requires a socket, a port, or a child process. A fake `req` (`{ method, url, headers, on() }`) and a fake `res` (`{ writeHead(), end() }`) are enough to drive the whole stack: routing → the `?token=` fold → `context()` → policy composition → the Data Plane → the status mapping.

**No production code changes to make this testable.** That matters and is worth stating: a seam that has to be widened for a test is a seam whose test proves something slightly different from what ships. This one was already the right shape — it had simply never been used from in-process.

`context()` itself is deliberately **not** exported for this. Testing it directly would assert the piece; driving it through `api` asserts the composition, which is where C1 actually was — `context` was fine, the policy set it composed was not.

## 2. What gets pinned

The clauses target decisions, not endpoints.

**The auth seam (`HTTPX-A*`)**
- With no auth configured, the dev identity is issued and `x-nexus-user` names it. That branch is the one production must never reach, and `START-01` only proves production *refuses* — nothing proved what dev actually grants.
- With auth configured, no credential is `E_AUTH` 401.
- A valid API key yields exactly that key's roles; a wrong key is refused (and the comparison stays constant-time — SEC-06 pins the primitive, this pins its use).
- **Roles come from the live directory, never the token's claims.** A token minted carrying `roles: ["admin"]` for a user the directory lists as `viewer` must act as a viewer. `AUTH-REVOKE` proves revocation over a subprocess; this proves the mechanism at the seam, in one call, with the directory in a state a subprocess test would have to construct an instance to reach.
- An unprovisioned pub with a *technically valid* token gets no roles at all (C1b's other half).

**Routing and the transport contract (`HTTPX-R*`)**
- The `?token=` fold applies to `_events` only. An ordinary entity route with `?token=` is anonymous — that a query-string token cannot authenticate a data read is the invariant, and `STUDIO-09b` pins the same rule for `_session` while nothing pinned it for entity routes.
- A body over 1MB is `413 E_BODY_SIZE`, and the request is destroyed *after* the response.
- The status mapping is a contract, not an implementation detail: `E_FORBIDDEN`→403, `E_NOT_FOUND`→404, unknown entity→404, validation→400, anything without an `E_` code→500. It is what every client's error handling is written against.
- A path outside the API base returns `false` rather than a response, so a host server can fall through to its own routes.

**Policy composition (`HTTPX-P*`)**
- The effective set is app + system + admin + rows, and the read-only window (`layersDoc`) derives from the *same* `policyLayers()` call rather than re-enumerating — so the window can never describe a policy set the engine does not enforce. `POLWIN-*` proves the window's shape over HTTP; this proves the two cannot drift apart, which is the property that made the window trustworthy in the first place.

## 3. What this chunk is NOT

- **Not** deleting or weakening the subprocess suites. `START-*`/`STUDIO-*` prove real HTTP, real TLS, real process boundaries. In-process clauses prove decisions. Both are needed, and replacing one with the other would trade away the thing it is good at.
- **Not** in-process coverage of `dev.js`. Its `/_studio/*` handlers are already pinned by `STUDIO-08..13` plus the declarative `dev-access.js` table (`STUDIO-10` is an invariant over the routes it actually handles), and the destructive path moved into core in chunk 2 where it is now clause-covered. What is left there is a route body, not a decision.
- **Not** `update.js`/`uninstall.js`, the coverage map's other entry. Self-update does `git fetch` + hard reset; testing it means a scratch git remote and a lifecycle contract that **issue #8 has not decided yet**. Writing clauses against undecided behaviour would freeze it by accident. Recorded in STATUS as owed to #8, not silently skipped.
- **Not** a coverage percentage. No number is claimed anywhere.

## 4. Error handling

No new refusals. This chunk adds no production behaviour; if a clause here goes red, the fix is in the code it pins, not in the clause.

## 5. Testing

| Clause | Asserts |
|---|---|
| `HTTPX-A01` | no auth configured → dev identity, named by `x-nexus-user` |
| `HTTPX-A02` | auth configured, no credential → `E_AUTH` 401 |
| `HTTPX-A03` | a valid API key yields that key's roles; a wrong key is refused |
| `HTTPX-A04` | a token's `roles` claim is IGNORED — the live directory decides |
| `HTTPX-A05` | a valid token for an unprovisioned pub carries no roles |
| `HTTPX-R01` | `?token=` authenticates `_events` only; an entity route with it is anonymous |
| `HTTPX-R02` | a >1MB body is 413 `E_BODY_SIZE` |
| `HTTPX-R03` | the status mapping holds across 403 / 404 / 400 / 500 |
| `HTTPX-R04` | a path outside the base returns `false`, so a host server can fall through |
| `HTTPX-P01` | the enforced set and the window derive from ONE `policyLayers()` — they cannot drift |

## 6. Out of scope, recorded

`update.js`/`uninstall.js` coverage, owed to issue #8's decisions. Streaming restore (chunk 3). Everything else issue #9 raised is closed.
