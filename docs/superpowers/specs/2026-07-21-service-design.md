# Install lifecycle, part 2: the service — design

**Date:** 2026-07-21
**Issue:** #8, answers 5 (service strategy), 6 (post-update restart) and 10 (macOS envelope), ratified 2026-07-21.

**Baseline:** 710/757 node · 47/47 browser · 0 red, CI green on `main`.

**The sentence this chunk is accountable to:** *`nexus start` survives a reboot without root, and everything it installed can be seen, restarted and removed by name.*

This is the **only** step in issue #8 that puts a long-lived process on a machine. That is why it is separate: everything in part 1 was bookkeeping that could not, by construction, leave something running.

---

## 0. Why access's answer does not transfer, and what does

Access runs triple redundancy: a system `systemd` daemon, a 5-minute timer, and a cron line beneath both. Nexus cannot copy it and should not want to.

**Cannot:** access installs as **root** to **FHS paths**; its units are *system* units. Nexus lives in `$HOME` with **no sudo** (`install.sh:8`), so the only mechanism available is `systemd --user`.

**Should not:** access needs a timer because its job is a *periodic DDNS sync* — the timer is the work. Nexus's job is a *long-lived server*. A timer there is not a second layer of safety; it is a second thing that can **start a duplicate process**. Redundancy is a virtue only when the layers do different work.

What does transfer is the doctrine: **graceful degradation over abort** (access prints `WARNING:` and continues when systemd is unavailable, rather than failing the install), **ask before destructive steps**, and **one shared render path** so install and update cannot drift.

### The fact that makes a no-root service possible

`systemd --user` units are killed at logout unless lingering is enabled. Verified on this machine (Debian 13, systemd 257):

- `loginctl show-user` → **`Linger=no`** — so a user unit would indeed die at logout by default.
- `/usr/share/polkit-1/actions/org.freedesktop.login1.policy` → `set-self-linger` carries **`<allow_any>yes</allow_any>`** — so **`loginctl enable-linger $USER` succeeds without root.**

That was worth checking rather than assuming: had linger required root, the honest answer to answer 5 would have been *"there is no service story without sudo"*, and this document would say that instead.

## 1. Shape: plan, then apply

`servicePlan()` is **pure** — it decides what unit to write, where, which commands would run, and what to record. `serviceApply()` performs it.

This is not stylistic. A clause that installed a real unit would enable a real background process on whoever ran the suite. The plan/apply split is what makes the decision assertable without doing it, and it is the shape `migrate.js` (plan/hotApply) and `lifecycle.js` (entityDeletePlan/applyEntityDelete) already use.

## 2. What gets installed

One user unit per instance, named after it:

```ini
[Unit]
Description=Nexus — <instance>
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=<instance>
ExecStart=<node> <nexus.js> start
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
```

Written to `${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user/nexus-<instance>.service`, then `systemctl --user daemon-reload` + `enable --now`.

**Lingering is requested, explained, and not fatal.** `loginctl enable-linger` is attempted; if it fails, the service still installs and the operator is told plainly that it will start at login rather than at boot. Aborting the whole install because one property could not be set is the opposite of the access lesson.

## 3. Where there is no systemd: one fallback, not two

An `@reboot` cron line, marker-based so it is idempotent and so uninstall can remove exactly it and nothing else (`crontab -l | grep -v "<marker>"`, access's `init.sh:48-54` pattern reused rather than reinvented).

This is a *fallback*, not a second layer: it is installed only when systemd is unavailable. Running both would be the duplicate-process problem from §0.

## 4. macOS and Windows refuse, and say why (answer 10)

`nexus service install` on Darwin refuses with *"not supported yet — run `nexus start` under your own supervisor"*, and writes nothing. launchd is a genuinely different mechanism (plist + `launchctl`), and shipping it untested on hardware nobody here has is the exact mistake issue #8 exists to prevent.

Nexus already has the honest precedent: MySQL is contract-pinned and **declared unproven** rather than claimed. Same treatment. Windows is the same refusal for the same reason.

## 5. Post-update restart (answer 6)

`nexus update`, after a successful reset, restarts **what the manifest says it installed** — `systemctl --user try-restart <unit>`.

`try-restart`, not `restart`: a unit the operator deliberately disabled must not be force-started by an update. That is access's exact choice (`update.sh:64`) and the reasoning carries over unchanged.

Not a supervisor watching the tree: that is a second long-lived process to install, supervise and uninstall, and it would fire on every file `git reset --hard` touches. The manifest already knows the answer.

## 6. Uninstall

Part 1 built the manifest with `units` and `cronMarkers` reserved and empty. This fills them, so `uninstall` disables and removes exactly the units it installed and strips exactly its cron lines — no guessing, which was the whole point of the manifest.

## 7. What this chunk is NOT

- **Not** launchd or a Windows service (§4 — refused and declared).
- **Not** a timer or any second supervision layer (§0).
- **Not** multi-instance orchestration: one unit per instance, installed by an operator who asked for it. Deciding *which* instances a machine should run is a deployment question, not a CLI one.
- **Not** automatic. `install.sh` does **not** install a service. A dev tool that registers a background process behind your back is how `curl | sh` earns its reputation.

## 8. Error handling

Refusals are typed and specific: `E_SERVICE_PLATFORM` (Darwin/Windows), `E_NO_INSTANCE` (run outside an instance), `E_SERVICE_MANAGER` when neither systemd nor cron is available. Linger failure is a **warning**, never an error. Removing a unit that is already gone is a no-op, not a failure.

## 9. Testing

| Clause | Asserts |
|---|---|
| `SVC-01` | the unit runs `nexus start` in the instance directory, restarts always, and is wanted by `default.target` |
| `SVC-02` | Darwin and Windows refuse with `E_SERVICE_PLATFORM` and plan no writes at all |
| `SVC-03` | with no systemd, the plan degrades to a marker-based `@reboot` cron line — and never plans BOTH |
| `SVC-04` | the plan names what the manifest must record, so uninstall can undo it by name |
| `SVC-05` | uninstall's plan includes the recorded units and cron markers |
| `SVC-06` | update restarts with `try-restart`, never `restart` — a disabled unit stays disabled |
| `SVC-07` | linger is requested, and a refusal downgrades to a warning that still installs the service |
| `SVC-08` | running outside an instance refuses with `E_NO_INSTANCE` rather than installing a unit pointing nowhere |
