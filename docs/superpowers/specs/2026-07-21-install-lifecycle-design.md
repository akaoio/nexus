# Install lifecycle, part 1: state, manifest, lock — design

**Date:** 2026-07-21
**Issue:** #8, answers 1, 2, 3, 4, 7, 9 (ratified 2026-07-21). Answers 5, 6 (service + post-update restart) get their own design; 8 and 10 are small and independent and ride along at the end.

**Baseline:** 701/748 node clauses / 47/47 browser / 0 red, CI green on Node 22 and 24.

**The sentence this chunk is accountable to:** *the installer records what it changed, so uninstall can undo exactly that and nothing else — and no two updates can run at once.*

This is the bookkeeping half. It adds **no long-lived process**; that is deliberately step 3's job and step 3's spec.

---

## 0. The concrete defect that makes the manifest non-optional

`uninstall.js` does not know what the installer did. It **guesses**:

```js
const shims = [
    join(homedir(), ".local", "bin", "nexus"),
    join(NEXUS_ROOT, "shims", "nexus.cmd")
].filter(existsSync)
```

Those two paths are the *defaults*. But `install.sh` writes its shim to `${NEXUS_BIN:-$HOME/.local/bin}` — so **an operator who set `NEXUS_BIN` gets a shim uninstall will never find**, leaving a `nexus` on PATH pointing at a deleted tree. The guess is right only for the case where guessing was unnecessary.

And it cannot cover PATH at all. `install.ps1` appends to the persistent user PATH; `uninstall.js` ends with *"PATH entries added by the installer can be dropped whenever"* — an admission that uninstall is incomplete by design. That gets worse the moment step 3 adds service units and cron lines.

One mechanism fixes all of them: **the installer writes down what it changed.**

## 1. State directory (answer 3)

`$NEXUS_HOME/.state/` — inside the install, not `$XDG_STATE_HOME`. The install being **one directory** is what makes uninstall a single `rmSync`, and splitting state out would give two roots to reason about and two things to find. (`XDG_STATE_HOME` is unset on a stock Debian shell anyway, so the "standard" path is a fallback chain with no user behind it.)

Contents:

| File | Purpose |
|---|---|
| `install.json` | the manifest — what the installer changed |
| `last-update.json` | channel, ref, commit, timestamp |
| `update.lock` | the exclusive lock, held only while updating |

## 2. Manifest (answer 2)

```jsonc
{
  "manifestVersion": 1,
  "installedAt": "2026-07-21T…",
  "channel": "git" | "tarball" | "zip" | "npm",
  "home": "/home/x/.nexus",
  "shims": ["/home/x/.local/bin/nexus"],
  "pathEntries": ["/home/x/.local/bin"],   // Windows: what was appended to user PATH
  "units": [],                              // step 3 fills these
  "cronMarkers": []                         // step 3 fills these
}
```

`manifestVersion` because this is a format the next version has to read (N4). Steps 3's fields exist now and stay empty, so adding a service later is data, not a schema change.

**`uninstall` reads it and removes exactly what it names.** With no manifest — an install predating this — it falls back to today's guess and says so. That fallback is not politeness: N3 means an existing install must keep uninstalling cleanly, and a clause pins both directions.

## 3. Reinstall contract (answer 1)

`install.sh` gains, **before it touches anything**:

- `git status --porcelain` empty → silent `fetch` + `reset --hard`, exactly as today. This has to stay: the installer is documented as a `curl | sh` one-liner and re-running it must be idempotent.
- Not empty → **refuse**, print the dirty paths, exit non-zero, and say that `NEXUS_FORCE=1` overrides.

An env var rather than a prompt because a piped installer has no terminal — access guards every one of its prompts with `[ -c /dev/tty ]` for exactly this reason, and a safeguard that cannot be answered in the documented invocation is not one. The rule is *never destroy unexamined work*, not *always ask*.

The check must come **before** the network call, so refusing costs nothing and leaves the tree untouched. That ordering is the clause.

## 4. Update lock (answer 9)

`fs.openSync(lock, "wx")` — Node's atomic exclusive-create, the closest thing to access's non-blocking `flock`, and unlike `flock` it exists on every platform Node supports. Contents: pid + start time.

A lock whose **pid is gone**, or which is older than a timeout, is stale and reclaimable. Otherwise `nexus update` refuses with `E_UPDATE_LOCKED` naming the holder.

Access added its lock *after* a real overlap regression. Having it before step 3 gives anything the ability to trigger an update is the cheap order.

## 5. Update record + channel (answer 7)

`nexus update` writes `{channel, ref, commit, at}` on success. Tracking `main` stays the policy at 0.0.0 — stable/beta would be ceremony over one branch — but recording the field now is what makes `--channel` a later config change rather than a redesign, and it is what lets `doctor` answer *"when was the framework last updated, and through which channel?"*, which nothing can answer today.

## 6. Install-scope doctor (answer 4)

One command, two scopes. Inside an instance `nexus doctor` is unchanged. Outside one — or with `--install` — it reports: channel, home, shim presence and whether each is on PATH, last update, and manifest presence.

Not a second command: §5.2 keeps the CLI surface small, and two commands means knowing which to run *before* knowing what is wrong.

## 7. What this chunk is NOT

- **Not** the service story (answers 5, 6). That is the only step that puts a supervised process on the machine and it gets its own design document. The manifest's `units`/`cronMarkers` fields are reserved for it and stay empty here.
- **Not** the tarball SHA check (8) or the Darwin service refusal (10) — small, independent, and they follow.
- **Not** a change to what `nexus update` *does* to the tree: `git fetch` + hard reset is the access lesson and is correct.

## 8. Error handling

`E_UPDATE_LOCKED` when another update holds the lock. `install.sh` exits non-zero on a dirty tree with the paths named. A missing or unreadable manifest is **not** an error — it is an older install, and it degrades to the documented fallback. A corrupt manifest IS an error, because silently treating it as absent would delete less than the operator expects.

## 9. Testing

`update.js` and `uninstall.js` have had **no clauses of any kind** — the last entry on issue #9's coverage map, left open on purpose until this issue decided the contract. That ends here.

| Clause | Asserts |
|---|---|
| `INST-01` | the manifest round-trips; an absent one reads as `null`, a corrupt one throws |
| `INST-02` | uninstall removes exactly what the manifest names — including a shim at a non-default `NEXUS_BIN` — and nothing else |
| `INST-03` | with no manifest, uninstall still removes the documented defaults (an older install keeps working, N3) |
| `INST-04` | the update lock is exclusive: a second holder is refused `E_UPDATE_LOCKED` naming the first |
| `INST-05` | a lock whose pid is gone is reclaimed rather than blocking forever |
| `INST-06` | a successful update records channel, ref and commit |
| `INST-07` | `nexus doctor --install` reports channel, home, shims and last update |
| `INST-08` | `install.sh` refuses a dirty checkout **before any network call**, names the paths, and leaves the tree untouched; `NEXUS_FORCE=1` proceeds |
| `INST-09` | `nexus update` on an npm-managed or tarball install still says exactly how to update it, and takes no lock it cannot release |
