# The production Studio's build lifecycle — design

**Date:** 2026-07-22
**Source:** STATUS's own disclosure — *"`nexus studio build` is on-demand only — it is NOT yet wired into `nexus create` or `nexus update`, though the design spec (§2.4) anticipated that wiring… A freshly created instance therefore has no production Studio until an operator runs `nexus studio build` by hand."*

**Baseline:** 742/792 node · 50/50 browser · 9/9 e2e · 0 red.

**The sentence this chunk is accountable to:** *a built Studio knows what it was built from, and anything that invalidates it says so.*

---

## 0. Why "wire the build into two more commands" is the wrong reading

The disclosure describes the gap as missing wiring, and taken literally it has an easy fix: call `buildStudio()` at the end of `create` and again at the end of `update`. One half of that is right. The other half cannot be done at all, and noticing why exposes the real defect.

**`nexus update` does not know what to rebuild.** It updates the *framework installation* the binary belongs to — a global deployment of `origin/main` — and has no register of the instances running against it. There is no list to walk. So `update` cannot rebuild anything, and the wiring the spec anticipated does not exist to be added.

**What `update` actually does is invalidate every build in the world, silently.** A built Studio is a copy of the framework's own `src/studio/**` and `vendor/**`, frozen at build time. The moment the framework moves underneath it, every instance is serving old Studio code against a new server, and nothing anywhere notices. That is the same class of problem as the boot-time auth snapshot: a value captured once, an event that invalidates it, and no link between the two.

**Schemas drift the same way and faster.** `buildStudio` bakes `boot.schemas` into the shell — full schema documents. Edit a model in `nexus dev` and the built Studio's baked copy is wrong: it will render forms for fields that no longer exist and miss ones that do. This needs no `update` at all, only an afternoon's work in the schema designer.

So the honest statement of the problem is not *the build is not wired in*. It is:

> **A built Studio is a snapshot of (framework source × instance schemas) that records neither, so nothing can tell whether it is still true.**

Wiring the build into `create` without fixing that would only move the moment the staleness begins.

## 1. A build records what it was built from

`buildStudio` writes `build.json` into the output root:

```json
{
    "builtAt": "2026-07-22T…Z",
    "framework": { "version": "0.x.y", "commit": "8d7e9cc…" },
    "schemas": "sha256:…"
}
```

`framework.commit` is read from the framework's git checkout when there is one, and is `null` otherwise (a tarball or npm install has no commit to read). `schemas` is a fingerprint over the schema documents that were actually baked, hashed through a **deterministic** serialisation — key order in a loaded JSON document is not a contract, and a fingerprint that changed when a field was merely reordered would cry wolf until it was ignored.

## 2. Staleness is computed by a pure function, not by whoever is printing

```js
frameworkStamp(root)          // { version, commit }
schemaFingerprint(schemas)    // "sha256:…"
readBuildStamp(dir)           // the parsed build.json, or null
stalenessOf(stamp, current)   // { stale, reasons: [...] }
```

in `src/cli/studio-stamp.js`. This is the whole point of splitting it out: the interesting behaviour is a comparison over data, and a comparison over data can be driven from a Node clause across every case — missing stamp, older commit, changed schemas, both — without booting a server for any of them. Only the *reporting* needs a server, and only one clause needs to prove the report reaches the operator.

Three cases the comparison must get right, because each is a different answer:

- **No `build.json` at all.** Either there is no build (say so plainly: production has no Studio, here is the command) or the build predates this mechanism (same remedy, so the same message serves).
- **`framework.commit` is null on both sides.** A tarball install cannot tell a commit-level drift from none, and the honest response is to say the version matched and that this install cannot see finer than that — not to claim freshness it did not verify.
- **Schemas differ.** The single most common case, reachable without updating anything.

## 3. Where the answer surfaces

**`nexus start` warns; it never refuses.** The data plane does not depend on the built Studio, and refusing to serve an API because an admin UI is stale would be a worse failure than the staleness. One line, naming what drifted and the command that fixes it.

**`nexus doctor` reports it as a check** — that is what doctor is for, and it is where someone looks when a page is behaving oddly.

**`nexus create` does NOT build — and following the consequence is what settled it.**

The obvious move was to build at creation: we are in the instance directory, the schemas are freshly written, and the measured cost on the development machine (an Orange Pi, aarch64) is 1.1s for 416 files. It was implemented that way first. Then two clauses went red — `START-03` ("exposes no Studio") and `START-STUDIO-ABSENT` — and the reason they went red is the argument against it:

`/` is a Studio route (`studioRouteMatches` returns true for the bare root), and `nexus start` checks the built Studio **before** the static handler. So a build present means the site root serves the Studio shell. That shell is served **pre-authentication** — it has to load before login can happen — and it **bakes full schema documents** into its boot payload: field names, types, permlevels. STATUS already discloses this as "a small new reconnaissance surface".

Building at `create` would take that surface from *instances whose operator chose to build one* to *every instance in existence*, by default, as a side effect of a task described as wiring. The size of the surface is arguable; making it default-on without anyone deciding to is not.

So the disclosure's framing — a fresh instance "has no production Studio until an operator runs `nexus studio build` by hand" — is only half a gap. On-demand is the right default. **The actual gap is that nothing tells you the command exists**: an operator meets it as a bare 404 on every Studio route, with nothing anywhere connecting that to a build step.

That is what gets fixed:

- **`nexus start` says so once, plainly**, when an instance has no build — the same place it already reports auth mode and engine. One line, naming the command.
- **`nexus create`'s "Next steps" names it**, with what it is for, alongside `nexus dev` and `nexus test`.
- **`nexus doctor` reports it** as a check.

**`create` still writes a `.gitignore`.** `public/studio/` is generated output whenever the operator does build, and belongs there regardless; it carries the sqlite data files, `node_modules/`, and `.certs/` too.

**`nexus update` says what it just invalidated.** It cannot rebuild instances, so it tells the operator that every built Studio is now stale and names the command — after a successful update, and only then. This is the smallest honest thing it can do, and it is strictly better than the silence it replaces.

## 4. What this deliberately does not do

- **No auto-rebuild in `nexus dev`.** Dev serves the Studio from source through `/_nexus/*` and never reads the built tree, so a rebuild there would be pure cost for no reader.
- **No build at `create`, for the reason in §3** — not because it would be slow.
- **No auto-rebuild in `nexus start`.** Production booting into a build step means a boot that can fail for a new reason, and a server that writes to its own webroot at startup. The warning is the correct depth.
- **No content hash over the framework's files.** The commit is what `update` moves and what an operator can act on; hashing 416 files at every boot to detect a case the commit already covers would be a cost paid on every start for nothing.

## 5. Clauses

| Clause | Pins |
|---|---|
| `STAMP-01` | a build writes `build.json` naming framework version, commit, and a schema fingerprint |
| `STAMP-02` | the schema fingerprint is deterministic under key REORDERING and changes when a field changes |
| `STAMP-03` | `stalenessOf` — fresh, missing stamp, moved commit, changed schemas, and both at once, each with its own reason |
| `STAMP-04` | a commit-less install (tarball) reports what it could NOT check rather than claiming freshness |
| `STAMP-05` | `nexus start` warns on a stale build and still serves the data plane |
| `STAMP-06` | `nexus start` on an instance with NO build names the command instead of leaving bare 404s |
| `CREATE-STUDIO-01` | `create` does not build — and its "Next steps" names `nexus studio build` and what it is for |
| `CREATE-STUDIO-02` | a build the operator DOES run is stamped for the instance it was built for, and reads back fresh |
| `CREATE-GITIGNORE` | the generated `.gitignore` covers the built Studio and the data directory |
| `UPDATE-STUDIO-01` | a successful `update` tells the operator built Studios are now stale |
