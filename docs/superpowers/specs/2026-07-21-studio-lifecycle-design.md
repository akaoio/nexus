# Studio lifecycle & keyboard access — design

**Date:** 2026-07-21
**Source:** `ARCHITECTURE.md` §12 ("tầng UI/Studio đang được refactor… đây là điều chưa xong") and two items STATUS discloses: *"Studio router has NO unmount hook (`src/studio/app.js:181`) … A real teardown hook is the structural follow-up (architectural debt, documented)"* and *"Search overlay lacks keyboard navigation"*.

**Baseline:** 692/738 green / 0 red / 46 skipped on `worktree-http-coverage`.

**The sentence this chunk is accountable to:** *leaving a page releases what the page took, and the Studio is operable without a mouse.*

---

## 0. What the survey actually found

Both disclosed items are worse than their one-line descriptions, and one of them is not a UI issue at all.

**The router's missing unmount hook has been paid for at five call sites, in an identical line of code:**

```js
const unsubscribe = subscribe([...], () => {
    if (!host.isConnected) return unsubscribe() // the router has no unmount hook — stale routes reap themselves
    …
})
```

`routes/jobs`, `routes/permissions`, `routes/users`, `routes/roles` and `routes/entities` each carry it verbatim. Three consequences follow, and only the first is the one that was disclosed:

1. **A stale route unsubscribes on its next event — so if no event ever arrives, it never unsubscribes.** On a quiet instance a navigation leaks a subscriber permanently.
2. **The shared connection stays wider than it should.** `kit/events.js` connects with the *union* of every subscriber's entity list; a stale subscriber keeps its entities in that union, so the browser keeps receiving (and the server keeps evaluating per-subscriber permission for) entities nothing on screen is watching.
3. **It only reaps the subscription.** `routes/jobs` also holds a `setTimeout` — `reloadTimer` — which the pattern does not touch at all, so a burst-collapse timer scheduled just before navigation still fires `load()` against a dead route. Nothing in the current design *could* catch that; the incantation is subscription-shaped and the leak is not.

The duplication is the visible cost. The invisible one is that every future route has to remember an incantation, which is precisely the drift `ARCHITECTURE.md` §3 warns about ("hai cách làm một việc").

**The search overlay is not "missing arrow keys" — it has no keyboard handling of any kind.** No `keydown`, no `tabindex`, no `role`, no `aria-*`. A keyboard or screen-reader user cannot reach a result at all. That is an accessibility defect, not a missing convenience, and it should be described as one.

**One documentation drift, found while reading:** `kit/events.js`'s header says the connection "is replaced only when the union **grows**". The code replaces it on any key change, including when the union *shrinks* (`ensure()` compares the whole key). The comment understates what the code does — harmless today, but it is the kind of statement someone later "fixes" the code to match.

---

## 1. Give the router a real unmount hook

A new browser-safe kit module, `src/studio/kit/lifecycle.js`:

```js
onUnmount(fn)      // a route registers teardown while it renders
unmountCurrent()   // the router calls this BEFORE rendering the next route
commitMount()      // the router calls this AFTER render() returns
```

Every route's `render(ctx)` is **synchronous** (verified across all five — they return a host node and fill it asynchronously afterwards), so "whatever registered during this call belongs to this route" is exact, not a heuristic. That is what makes a registry this small correct; if a route ever became `async`, the model would need revisiting and a clause says so.

The router becomes:

```js
function render() {
    unmountCurrent()
    …
    const node = MODULES[state.view].render(ctx)
    commitMount()
    main.replaceChildren(node)
}
```

and the five routes become:

```js
onUnmount(subscribe([...], () => { … }))
onUnmount(() => clearTimeout(reloadTimer))
```

**A teardown that throws must not prevent the others from running, nor break navigation.** One route's bad cleanup taking the Studio down would be a worse failure than the leak it was cleaning up — same containment doctrine as the event hub's `visible()` and the plane's after-hooks. Failures are reported, never propagated.

**Re-rendering the same route unmounts and remounts.** A locale change re-renders in place; treating that as "no change" would leave the old subscription alongside the new one, which is the leak again with extra steps.

## 2. The search overlay becomes keyboard-operable

Following the harness discipline the Studio suites already use — **pure helpers in Node, DOM behaviour in the browser run** — the navigation logic is extracted rather than embedded in an event handler:

```js
nextIndex(current, count, key)   // "ArrowDown" | "ArrowUp" | "Home" | "End" → index
```

Rules, chosen deliberately:
- Wrap around at both ends. A results list is a cycle; stopping at the end makes the last item feel broken.
- `-1` (nothing selected) + `ArrowUp` selects the **last** item — the standard "open upward" behaviour of every command palette.
- An empty result set has no selection to move to and returns `-1` rather than `0`, so `Enter` on an empty list does nothing instead of opening a hit that is not there.

Wiring (browser): `keydown` on the input for Arrow/Home/End/Enter/Escape, `role="listbox"` on the results, `role="option"` + `aria-selected` per hit, `aria-activedescendant` on the input. Escape closes. Enter opens the selected hit.

## 3. What this chunk is NOT

- **Not** the component-discipline refactor. STATUS names hand-built DOM in the users list rows, roles cards, entities editor chrome, the settings form and `kit/fields.js`. That is a genuinely separate, larger piece of work touching a different set of files, and mixing it in would make both harder to review. It stays in Unfinished.
- **Not** `span` drag-resize, and not the field-reorder DnD test.
- **Not** the browser E2E suite for login/cascade/hot-reload/accent. Those need the CDP runner and belong with the E2E debt.
- **Not** a change to the SSE wire contract or the hub. Chunk 3 already bounded the server side; this is the client's half of the same story.

## 4. Error handling

A teardown that throws is caught, reported with the route it belonged to, and the remaining teardowns still run. No other new failure paths — this chunk removes duplication and adds keyboard input; it does not introduce refusals.

## 5. Testing

All Node-runnable, none `{ browser: true }` — the point of extracting the logic is that it can actually be asserted.

| Clause | Asserts |
|---|---|
| `LIFE-UNMOUNT-01` | teardowns registered during a render run when the next route mounts, exactly once |
| `LIFE-UNMOUNT-02` | a throwing teardown does not stop the others, and does not propagate |
| `LIFE-UNMOUNT-03` | re-rendering the SAME route still unmounts first — no accumulation |
| `LIFE-UNMOUNT-04` | teardowns registered by a route that never committed are discarded, not attributed to the next one |
| `EVT-UNION-01` | the shared connection's key NARROWS when a subscriber leaves (the behaviour the header understates) |
| `EVT-UNION-02` | unsubscribing the last subscriber closes the connection rather than reconnecting to an empty union |
| `NXSR-KEY-01` | `nextIndex` wraps both ends, opens upward from nothing, and returns -1 for an empty list |
| `NXSR-KEY-02` | no route still carries the `host.isConnected` incantation — an invariant over the source, so the pattern cannot creep back |

`NXSR-KEY-02` is a structural clause in the style of `STUDIO-10`/`PROD-01`: the fix is only durable if re-introducing the old shape fails a clause.
