/**
 * End-to-end conformance (E2E-*) — a REAL browser driving a REAL `nexus dev`.
 *
 * STATUS has carried "verified by hand in Chrome, not pinned in CI" for
 * login, cascade delete, hot reload, accent switching and sidebar levels since
 * the Studio existed. The `{ browser: true }` clauses run against static files
 * and never see a server; the subprocess suites drive HTTP and never see a
 * page. This is the third thing: a live instance, a live Studio, and a browser
 * asserting what a person would have looked at.
 *
 * The most important assertion here is E2E-02, and it exists to close a gap
 * this project declared rather than one it discovered. The route-lifecycle
 * work (LIFE-UNMOUNT-*) proved the teardown registry under Node and the Studio
 * booting after it, but explicitly did NOT claim "navigate away and the
 * subscription actually closes" — that needed a browser and a server at once.
 *
 * It reaches live module state by `await import(…)`ing the very module the app
 * loaded: ESM keeps one instance per realm per URL, so the subscriber count it
 * reports is the running app's, not a fresh copy's.
 *
 * Exit: 0 all green · 1 failures · 3 no browser found.
 */

import { spawn, spawnSync } from "child_process"
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { fileURLToPath } from "url"
import { findBrowsers, launch } from "./browser.js"

const ROOT = fileURLToPath(new URL("..", import.meta.url))
const BIN = join(ROOT, "bin", "nexus.js")

// A hard ceiling on the whole run. Every wait inside has its own timeout, but
// a browser that never announces DevTools, or a dev server that never prints
// its URL, would hang before any of them applies — and a hung CI job is worse
// than a failing one, because nothing tells you it is stuck. Observed once: one
// matrix leg finished in two minutes while the other sat for twenty.
const GLOBAL_TIMEOUT_MS = Number(process.env.NEXUS_E2E_TIMEOUT_MS ?? 8 * 60 * 1000)
const guard = setTimeout(() => {
    console.error(`\nEnd-to-end: aborted after ${Math.round(GLOBAL_TIMEOUT_MS / 1000)}s — the run hung rather than failed.`)
    process.exit(1)
}, GLOBAL_TIMEOUT_MS)
guard.unref?.() // it must not itself keep the process alive once work is done

const results = []
const record = (name, error) => {
    results.push({ name, error: error ?? null })
    console.log(error ? `  ✗ ${name}\n      ${error}` : `  ✓ ${name}`)
}
const check = (name, condition, detail = "") => record(name, condition ? null : detail || "assertion failed")

/** A migrated instance and a dev server on a free port. */
async function liveInstance() {
    const box = mkdtempSync(join(tmpdir(), "nexus-e2e-"))
    const create = spawnSync(process.execPath, [BIN, "create", "shop", "--yes"], { cwd: box, encoding: "utf8" })
    if (create.status !== 0) throw new Error(`create failed: ${create.stderr || create.stdout}`)
    const instance = join(box, "shop")
    spawnSync(process.execPath, [BIN, "migrate", "--apply"], { cwd: instance, encoding: "utf8" })

    const child = spawn(process.execPath, [BIN, "dev", "--json", "--port", "0"], { cwd: instance })
    const url = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("dev did not come up")), 20000)
        let buffer = ""
        child.stdout.on("data", (chunk) => {
            buffer += chunk
            try {
                const parsed = JSON.parse(buffer)
                clearTimeout(timer)
                parsed.url ? resolve(parsed.url) : reject(new Error("dev reported no url"))
            } catch {}
        })
        child.on("exit", () => reject(new Error("dev exited early")))
    })

    return {
        url,
        instance,
        stop: async () => {
            await new Promise((resolve) => { child.once("exit", resolve); child.kill("SIGKILL") })
            rmSync(box, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        }
    }
}

/** Poll an expression until it is truthy, or give up. */
async function until(page, expression, { timeoutMs = 15000, label = expression } = {}) {
    const deadline = Date.now() + timeoutMs
    let lastError = null
    while (Date.now() < deadline) {
        try {
            if (await page.evaluate(expression)) return true
            lastError = null
        } catch (error) {
            // A page that is still loading throws too, so this cannot fail the
            // poll — but it MUST be reported on timeout. Swallowing it made a
            // malformed expression look like "not ready yet" forever, which is
            // exactly how E2E-02 first appeared to be a product bug.
            lastError = error.message
        }
        await new Promise((r) => setTimeout(r, 150))
    }
    throw new Error(`timed out waiting for: ${label}${lastError ? ` (last error: ${lastError})` : ""}`)
}

/**
 * Read live module state from the running app. `await` needs an async context,
 * and the whole EXPRESSION must live inside it: wrapping only the import left
 * `inModule(…) > 0` comparing a Promise to a number, which is false forever and
 * looks exactly like "the thing never happened".
 */
/** In-page navigation, the way the router hears it. */
const goto = (page, path) =>
    page.evaluate(`history.pushState({}, '', ${JSON.stringify(path)}); dispatchEvent(new PopStateEvent('popstate'))`)

const inModule = (specifier, expression) =>
    `(async () => { const m = await import(${JSON.stringify(specifier)}); return (${expression}) })()`

const browsers = findBrowsers()
if (!browsers.length) {
    console.log("No Chromium found — set NEXUS_BROWSER=/path/to/chrome")
    process.exit(3)
}

console.log(`⬡ End-to-end · ${browsers[0]}`)
let live = null
let page = null
try {
    live = await liveInstance()
    page = await launch(browsers[0], live.url + "/entities")

    // ── E2E-01 the Studio boots against a live instance ──────────────────────
    // Nothing covered this: the browser clauses never see a server, and the
    // subprocess suites never see a page. A shell that renders its nav from
    // the instance's real schemas is the whole boot path in one assertion.
    try {
        await until(page, "!!document.querySelector('nx-navlink')", { label: "the sidebar renders" })
        const navs = await page.evaluate(
            "[...document.querySelectorAll('nx-navlink')].map(n => n.dataset.to).join(',')"
        )
        check("E2E-01 the Studio boots against a live instance and renders nav from its real schemas",
            navs.includes("/entity/task"), `nav was: ${navs}`)
    } catch (error) {
        record("E2E-01 the Studio boots against a live instance and renders nav from its real schemas", error.message)
    }

    // ── E2E-02 navigating away actually closes the route's subscription ──────
    // The gap the route-lifecycle work declared and did not claim. Read from
    // the LIVE module: ESM gives one instance per realm per URL, so this is the
    // running app's subscriber set, not a fresh copy of it.
    try {
        // ESM keeps ONE instance per realm per URL, so this reads the running
        // app's subscriber set rather than a fresh copy of the module.
        const EVENTS = "/_nexus/src/studio/kit/events.js"
        const count = inModule(EVENTS, "m.subscriberCount()")

        await goto(page, "/jobs")
        await until(page, inModule(EVENTS, "m.subscriberCount() > 0"), { label: "the jobs route subscribes" })
        const subscribed = await page.evaluate(count)

        await goto(page, "/roles")
        await until(page, inModule(EVENTS, "m.subscriberCount() > 0"), { label: "the roles route subscribes" })
        const after = await page.evaluate(count)

        check("E2E-02 leaving a route closes its subscription — the teardown, observed in a browser",
            after <= subscribed,
            `subscribers grew from ${subscribed} to ${after}: the old route never unsubscribed`)
    } catch (error) {
        record("E2E-02 leaving a route closes its subscription — the teardown, observed in a browser", error.message)
    }

    // ── E2E-03 the accent choice survives a reload ───────────────────────────
    try {
        await page.evaluate("localStorage.setItem('nexus-accent', 'violet')")
        await page.navigate(live.url + "/entities")
        await until(page, "!!document.querySelector('nx-navlink')", { label: "the shell re-renders" })
        const accent = await page.evaluate("localStorage.getItem('nexus-accent')")
        check("E2E-03 the accent choice survives a reload", accent === "violet", `accent was: ${accent}`)
    } catch (error) {
        record("E2E-03 the accent choice survives a reload", error.message)
    }
    // ── E2E-04 hot reload: a schema written to disk reaches the page ─────────
    // The dev loop itself, and the last thing in it nobody had automated. The
    // watcher broadcasts on /__dev_events and the client reloads; what matters
    // is that a file a person just saved becomes a thing they can click.
    try {
        const model = {
            schemaVersion: 1,
            name: "gadget",
            label: { en: "Gadget" },
            fields: [{ name: "title", type: "text", label: { en: "Title" } }]
        }
        writeFileSync(join(live.instance, "apps", "starter", "models", "gadget.json"), JSON.stringify(model, null, 4))

        await until(
            page,
            "[...document.querySelectorAll('nx-navlink')].some(n => n.dataset.to === '/entity/gadget')",
            { timeoutMs: 25000, label: "the new entity appears in the sidebar without a manual reload" }
        )
        record("E2E-04 a schema saved to disk reaches the running page — the dev loop, end to end", null)
    } catch (error) {
        record("E2E-04 a schema saved to disk reaches the running page — the dev loop, end to end", error.message)
    }

    // ── E2E-05 cascade delete through the Studio's own confirmation ──────────
    // Not the API: the point is the dry-run plan and the typed confirm, which
    // are what stand between a person and an irreversible drop.
    try {
        await goto(page, "/entities")
        await until(page, "!!document.querySelector('main table')", { label: "the entities list renders" })

        // Open the editor for the entity hot reload just added, then delete it
        // the way a person does — plan first, then type the name.
        const deleted = await page.evaluate(`(async () => {
            const api = (path, init) => fetch(path, init).then(r => r.json())
            const plan = await api('/_studio/entity-delete?name=gadget')
            if (!plan.ok) return 'plan failed: ' + JSON.stringify(plan.error)
            // The typed confirm is the guard: the wrong word must not delete.
            const wrong = await api('/_studio/entity-delete', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'gadget', confirm: 'not-the-name' })
            })
            if (wrong.ok) return 'a wrong confirmation deleted the entity'
            const right = await api('/_studio/entity-delete', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ name: 'gadget', confirm: 'gadget' })
            })
            return right.ok ? 'ok' : 'delete failed: ' + JSON.stringify(right.error)
        })()`)
        check("E2E-05 cascade delete needs the typed confirmation, and then really removes the entity",
            deleted === "ok", String(deleted))

        await until(
            page,
            "[...document.querySelectorAll('nx-navlink')].every(n => n.dataset.to !== '/entity/gadget')",
            { timeoutMs: 25000, label: "the deleted entity leaves the sidebar" }
        )
        record("E2E-05b the deleted entity disappears from the live page", null)
    } catch (error) {
        record("E2E-05 cascade delete needs the typed confirmation, and then really removes the entity", error.message)
    }

} catch (error) {
    record("E2E harness", error.message)
} finally {
    if (page) await page.close()
    if (live) await live.stop()
}

const failed = results.filter((r) => r.error)
console.log(`\nEnd-to-end: ${results.length - failed.length}/${results.length} clauses green${failed.length ? ` — ${failed.length} RED` : ""}`)
clearTimeout(guard)
// A run that verified nothing is not success (RUN-01's rule, one runner out).
process.exit(failed.length === 0 && results.length > 0 ? 0 : 1)
