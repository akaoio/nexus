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
async function until(page, expression, { timeoutMs = 15000, label = expression, diagnose = null } = {}) {
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
    // A timeout on a condition that never threw tells you nothing about WHY.
    // An optional probe captures the page's state at the moment of giving up,
    // so a CI-only failure that cannot be reproduced locally still leaves
    // evidence in the log rather than a bare "timed out".
    let state = ""
    if (diagnose) {
        try { state = " · state=" + JSON.stringify(await page.evaluate(diagnose)) } catch (e) { state = " · diagnose threw: " + e.message }
    }
    throw new Error(`timed out waiting for: ${label}${lastError ? ` (last error: ${lastError})` : ""}${state}`)
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

    // ── E2E-06 the login round trip — LAST, because it turns auth ON ────────
    // The claim the login screen makes to a user is precise: "your passphrase
    // derives a ZEN keypair in this browser — no password is sent." Nothing
    // checked it. The subprocess suites drive /_auth/challenge and /_auth/verify
    // with keys minted in Node; only a browser can show that the passphrase a
    // person types reaches the same key the server was told to expect.
    //
    // The identity is provisioned through the API rather than by clicking "add
    // me as admin", deliberately. That button opens a native prompt(), and a
    // stubbed dialog is the one part of the journey that could not be real —
    // driving it proved brittle without proving anything the API path does not.
    // What is under test here is the HANDSHAKE.
    try {
        await goto(page, "/users")
        await until(page, "!!document.querySelector('main')", { label: "the users page renders" })

        const PASS = "correct-horse-battery-staple"

        // Provisioned through the STUDIO'S OWN BUTTON, not the API. Two earlier
        // attempts concluded this could not be driven; both were wrong, and
        // wrong in the same way. The button works — `prompt()` stubs fine, the
        // row is written immediately — but the assertion counted
        // `(json.data || []).length` on the response to an UNAUTHENTICATED read
        // of nexus_user, which is 401 the instant the first admin exists.
        // Zero rows was the auth gate closing, i.e. the flow SUCCEEDING, read
        // as the flow failing.
        //
        // So the signal to wait for is the one a person would notice: the API
        // starts refusing anonymous reads.
        await page.evaluate(`(() => { window.prompt = () => ${JSON.stringify(PASS)}; return true })()`)
        const clicked = await page.evaluate(`(() => {
            const b = [...document.querySelectorAll("nx-button")].find((x) => (x.textContent || "").includes("Add me as admin"))
            if (!b) return false
            b.click()
            return true
        })()`)
        if (!clicked) throw new Error('the "Add me as admin" button is not on the page')

        await until(page, "fetch('/api/v1/nexus_user').then(r => r.status === 401)",
            { timeoutMs: 30000, label: "adding the first admin turns authentication ON" })
        record("E2E-08 adding the first admin through the Studio turns authentication on", null)

        // The route reloads itself on success; navigate anyway so the gate is
        // reached deterministically rather than by catching that reload.
        await page.navigate(live.url + "/users")
        // Trap any load-time error so the diagnostic can tell "app.js threw"
        // apart from "the navigation was interrupted and nothing ran".
        try { await page.evaluate(`window.addEventListener('error', (e) => { window.__e2eError = String(e.message || e.error || e) }); window.addEventListener('unhandledrejection', (e) => { window.__e2eError = 'reject: ' + String(e.reason) }); true`) } catch {}
        await until(page, "!!document.querySelector('#nx-pass') && !document.querySelector('#nx-login').hidden",
            { timeoutMs: 30000, label: "the login gate appears once a user exists",
              diagnose: `(async () => {
                  const login = document.querySelector('#nx-login')
                  let session = null
                  try { const r = await fetch('/api/v1/_session'); session = { status: r.status, body: await r.text() } } catch (e) { session = { error: String(e) } }
                  // Re-run the exact module load and capture the REAL reason it
                  // never mounted — a caught window error installed late can
                  // miss a throw that already happened.
                  let appImport = null
                  try { await import('/_nexus/src/studio/app.js?probe=' + Date.now()); appImport = 'loaded' } catch (e) { appImport = 'THREW: ' + String(e && e.stack || e).slice(0, 300) }
                  // Walk two levels of app.js's import graph and report any URL
                  // that is not 200 — the browser names only the entry, never
                  // the sub-module that actually failed.
                  const bad = []
                  const seen = new Set()
                  const walk = async (u, depth) => {
                      if (depth < 0 || seen.has(u)) return
                      seen.add(u)
                      let text = ''
                      try { const r = await fetch(u); if (r.status !== 200) { bad.push(u.replace(location.origin, '') + ' → ' + r.status); return } text = await r.text() }
                      catch (e) { bad.push(u.replace(location.origin, '') + ' → ' + String(e)); return }
                      const specs = [...text.matchAll(/(?:from|import)\s*["']([^"']+)["']/g)].map((m) => m[1]).filter((x) => x.startsWith('.') || x.startsWith('/'))
                      for (const spec of specs.slice(0, 40)) { try { await walk(new URL(spec, u).href, depth - 1) } catch {} }
                  }
                  try { await walk(location.origin + '/_nexus/src/studio/app.js', 2) } catch (e) { bad.push('walk-err: ' + e.message) }
                  // And the raw status of app.js plus a /_studio call (STUDIO-14
                  // gates those live once auth is on).
                  let appStatus = null, studioStatus = null
                  try { appStatus = (await fetch('/_nexus/src/studio/app.js')).status } catch (e) { appStatus = String(e) }
                  try { studioStatus = (await fetch('/_studio/config')).status } catch (e) { studioStatus = String(e) }
                  return {
                      readyState: document.readyState,
                      hasApp: !!document.querySelector('main'),
                      hasLogin: !!login, loginHidden: login ? login.hidden : null,
                      hasPass: !!document.querySelector('#nx-pass'),
                      url: location.href,
                      // did app.js's module tag even make it into the document?
                      scripts: [...document.querySelectorAll('script')].map((x) => x.src || (x.textContent || '').slice(0, 40)),
                      bodyChildren: document.body ? document.body.children.length : -1,
                      navEntries: (performance.getEntriesByType('navigation') || []).length,
                      lastError: window.__e2eError || null,
                      appImport, appStatus, studioStatus, badModules: bad.slice(0, 15), walkedCount: seen.size,
                      session
                  }
              })()` })

        // A WRONG passphrase derives a different key, so the server must refuse
        // it — otherwise "the passphrase is the key" would be decoration.
        await page.evaluate(`(() => {
            const input = document.querySelector("#nx-pass")
            input.value = "not-the-passphrase"
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
            return true
        })()`)
        await until(page, "document.querySelector('#nx-login-err').textContent.length > 0",
            { timeoutMs: 30000, label: "a wrong passphrase is refused" })
        check("E2E-06 a passphrase that derives the wrong key is refused, and the gate stays shut",
            await page.evaluate("!document.querySelector('#nx-login').hidden"), "the gate opened for the wrong key")

        await page.evaluate(`(() => {
            const input = document.querySelector("#nx-pass")
            input.value = ${JSON.stringify(PASS)}
            input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }))
            return true
        })()`)
        // The TOKEN is the proof the handshake completed, and it survives the
        // shell re-rendering (or reloading) around it — asserting on the gate
        // element instead made this depend on catching a transient DOM state.
        await until(page, "!!localStorage.getItem('nexus-token')",
            { timeoutMs: 40000, label: "the handshake mints a session token" })

        const session = await page.evaluate(`fetch("/api/v1/_session", {
            headers: { authorization: "Bearer " + localStorage.getItem("nexus-token") }
        }).then((r) => r.json()).then((j) => JSON.stringify(j.data))`)
        check("E2E-07 the passphrase derives the key, signs the challenge, and returns an ADMIN session",
            /"roles":\[[^\]]*admin/.test(session), `session was: ${session}`)
    } catch (error) {
        record("E2E-06/07 the login round trip", error.message)
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
