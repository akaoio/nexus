# Realtime recovery after a dropped connection — design

**Date:** 2026-07-22
**Source:** STATUS — *"**Realtime event replay is not implemented** (`Last-Event-ID` v2 is deferred): reconnecting clients refetch the full list rather than resuming from a checkpoint. The hub is in-memory fan-out only — nothing is stored; a client that misses events recovers by refetching, not replay."*

**Baseline:** 763/813 node · 50/50 browser · 9/9 e2e · 0 red.

**The sentence this chunk is accountable to:** *a connection that dropped and came back leaves nothing stale on screen.*

---

## 0. Replay is not deferred work here — it is worse work

The entry reads as a feature waiting its turn. Reading what the stream actually carries changes that.

**The wire carries no row data.** STATUS states the exposure precisely: `{entity, event, id, ts}` only, "never row data — and any refetch through the ordinary API re-authorizes from scratch." So an event is not data; it is *a notification that something changed*. A client's response to one is to refetch.

Which means replaying missed events would hand a returning client a list of ids that changed while it was away — and **refetching the list already supersedes that**, completely, with the current truth rather than a history of intermediate states. Replay buys nothing a refetch does not already give.

It costs plenty:

- **Retention the hub deliberately does not have.** "In-memory fan-out only — nothing is stored" is a property, not an omission; storing a replay buffer means an unbounded structure keyed by nothing in particular.
- **Historical visibility, evaluated against present policy.** STATUS records that "subscriber ctx is captured once at connect, so a mid-session revocation or role change does not affect a live subscriber until it reconnects." Replaying events emitted *before* a reconnect means deciding whose visibility applies to them — the ctx at emit time, which is gone, or the ctx now, which was not in force then. Getting that wrong is precisely the shape of I11, the `after:remove` id leak this project already found and closed.

So `Last-Event-ID` should be **withdrawn**, not scheduled. What deserves to exist is the recovery it was standing in for.

## 1. The actual defect: the documented recovery was never wired

STATUS says a client "recovers by refetching". Nothing makes it refetch.

`kit/events.js` shares one `EventSource` across every subscriber. When the browser's transparent retry reconnects, subscribers hear nothing — their handlers fire on new events only. A route subscribed across a network blip therefore shows **stale data indefinitely**, until some unrelated later event happens to arrive and trigger its reload.

The blip does not have to be exotic: a laptop lid closing, a proxy idle timeout, a phone changing networks. Every list route in the Studio is affected, and the failure is silent — the page looks fine and is wrong.

## 2. A resync signal, not a checkpoint

On reconnection **after a drop**, every subscriber is notified once. Their handlers already say `() => load()`, so this is exactly the refetch STATUS describes — no new route code, no server change, nothing stored anywhere.

The distinction that has to be exact: a connection replaced **deliberately** — because the entity union changed when a route mounted or unmounted — is not a gap in coverage and must not resync. Only a connection that was *lost* leaves a hole. The browser tells us which: `error` with `readyState === CONNECTING` is a drop with a retry pending; the module's own 5-second retry after `CLOSED` is likewise a drop.

That decision is a tiny state machine with three inputs, so it is extracted as one — `createLinkState()` — and driven exhaustively from Node, where there is no `EventSource` at all. The wiring is asserted in a real browser against a fake `EventSource`, and the round trip in the end-to-end runner against a real server that is made to drop the connection.

A resync carries no `entity`/`id`/`ts`, so it must **bypass the dedupe set** rather than be silently swallowed by it — and it is delivered to every subscriber regardless of entity filter, because "you may have missed something" is not about any one entity.

## 3. Clauses

| Clause | Pins |
|---|---|
| `EVTSYNC-01` | a link that dropped and reopened resyncs; a deliberately replaced one does not |
| `EVTSYNC-02` | one resync per drop, however many opens follow, and none before the first ever connect |
| `EVTSYNC-03` | a resync reaches EVERY subscriber, past the entity filter and past the dedupe set |
| `EVTSYNC-04` | in a real browser, a dropped `EventSource` makes a subscribed route refetch |
