/**
 * Browser conformance runner — executes the { browser: true } clauses in a
 * real headless Chromium, zero dependencies (akao's /test route pattern,
 * automated).
 *
 *   npm run test:browser              # find a browser, run, report
 *   NEXUS_BROWSER=/path/to/chrome …   # explicit binary
 *
 * Drives the browser over raw CDP (Chrome DevTools Protocol) using Node's
 * built-in WebSocket — no puppeteer/playwright. (--dump-dom was tried first
 * and abandoned: modern headless_shell builds emit nothing for http:// URLs.)
 * The repo is served over HTTP (ES modules need real URLs); the page at
 * test/browser/page.html runs Test.run("browser") and publishes results in
 * document.title + a NEXUS_RESULTS block.
 *
 * Exit codes: 0 all green · 1 failures/timeout · 3 no browser found.
 */

import { createServer } from "http"
import { spawn } from "child_process"
import { existsSync, readFileSync, statSync, readdirSync, mkdtempSync, rmSync } from "fs"
import { join, resolve, extname } from "path"
import { tmpdir } from "os"

const ROOT = new URL("..", import.meta.url).pathname
const MIME = {
    ".html": "text/html; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".wasm": "application/wasm"
}

// ── Find Chromium candidates (purpose-built headless shells first) ───────────
function findBrowsers() {
    const candidates = []
    if (process.env.NEXUS_BROWSER) candidates.push(process.env.NEXUS_BROWSER)
    const playwright = join(process.env.HOME ?? "", ".cache", "ms-playwright")
    if (existsSync(playwright)) {
        const dirs = readdirSync(playwright).sort().reverse()
        for (const dir of dirs.filter((d) => d.startsWith("chromium_headless_shell")))
            candidates.push(join(playwright, dir, "chrome-headless-shell-linux", "headless_shell"), join(playwright, dir, "chrome-linux", "headless_shell"))
        for (const dir of dirs.filter((d) => d.startsWith("chromium-")))
            candidates.push(join(playwright, dir, "chrome-linux", "chrome"))
    }
    candidates.push("/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome")
    return candidates.filter((c) => existsSync(c))
}

// ── Minimal flat-protocol CDP client over Node's built-in WebSocket ──────────
function cdp(endpoint) {
    const socket = new WebSocket(endpoint)
    const pending = new Map()
    let nextId = 1
    socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data)
        if (message.id && pending.has(message.id)) {
            const { resolve, reject } = pending.get(message.id)
            pending.delete(message.id)
            if (message.error) reject(new Error(message.error.message))
            else resolve(message.result)
        }
    })
    const send = (method, params = {}, sessionId) =>
        new Promise((resolve, reject) => {
            const id = nextId++
            pending.set(id, { resolve, reject })
            socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
        })
    const ready = new Promise((resolve, reject) => {
        socket.addEventListener("open", resolve)
        socket.addEventListener("error", () => reject(new Error("CDP socket error")))
    })
    return { send, ready, close: () => socket.close() }
}

async function runInBrowser(binary, url) {
    const profile = mkdtempSync(join(tmpdir(), "nexus-browser-"))
    const headlessFlags = binary.includes("headless_shell") ? [] : ["--headless=new"]
    const child = spawn(binary, [
        ...headlessFlags,
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        "--disable-background-networking",
        "--disable-extensions",
        `--user-data-dir=${profile}`,
        "--remote-debugging-port=0",
        "about:blank"
    ])

    try {
        // The DevTools ws endpoint is announced on stderr
        const endpoint = await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("browser did not announce DevTools")), 15000)
            let buffer = ""
            child.stderr.on("data", (chunk) => {
                buffer += chunk
                const match = buffer.match(/DevTools listening on (ws:\/\/\S+)/)
                if (match) {
                    clearTimeout(timer)
                    resolve(match[1])
                }
            })
            child.on("exit", () => reject(new Error("browser exited before announcing DevTools")))
        })

        const client = cdp(endpoint)
        await client.ready
        const { targetId } = await client.send("Target.createTarget", { url })
        const { sessionId } = await client.send("Target.attachToTarget", { targetId, flatten: true })
        const evaluate = async (expression) =>
            (await client.send("Runtime.evaluate", { expression, returnByValue: true }, sessionId)).result.value

        // Poll until the page publishes its verdict in document.title
        const deadline = Date.now() + 30000
        let title = ""
        while (Date.now() < deadline) {
            title = (await evaluate("document.title")) ?? ""
            if (title.startsWith("NEXUS:")) break
            await new Promise((r) => setTimeout(r, 250))
        }
        if (!title.startsWith("NEXUS:")) throw new Error("timed out waiting for the page verdict")

        const block = await evaluate("document.getElementById('nexus-results').textContent")
        client.close()
        const match = block.match(/NEXUS_RESULTS_START(.*)NEXUS_RESULTS_END/s)
        if (!match) throw new Error("results block missing")
        return JSON.parse(match[1])
    } finally {
        child.kill()
        rmSync(profile, { recursive: true, force: true })
    }
}

// ── Serve the repo (modules need URLs) ────────────────────────────────────────
const server = createServer((req, res) => {
    const url = new URL(req.url, "http://localhost")
    const pathname = url.pathname === "/" ? "/test/browser/page.html" : url.pathname
    const path = resolve(ROOT, "." + pathname)
    if (!path.startsWith(ROOT) || !existsSync(path) || !statSync(path).isFile()) {
        res.writeHead(404)
        return res.end("Not found")
    }
    res.writeHead(200, { "content-type": MIME[extname(path)] ?? "application/octet-stream" })
    res.end(readFileSync(path))
})
await new Promise((ready) => server.listen(0, ready))
const url = `http://127.0.0.1:${server.address().port}/`

const browsers = findBrowsers()
if (!browsers.length) {
    console.log(`No Chromium found. Open manually: ${url}`)
    console.log("Or set NEXUS_BROWSER=/path/to/chrome")
    server.close()
    process.exit(3)
}

let results = null
for (const binary of browsers) {
    console.log(`⬡ Browser conformance · ${binary}`)
    try {
        results = await runInBrowser(binary, url)
        break
    } catch (error) {
        console.log(`  ${error.message} — trying the next binary`)
    }
}
server.close()

if (!results) {
    console.error("No browser produced results")
    process.exit(1)
}
if (results.status === "CRASH") {
    console.error("Page crashed:", results.error)
    process.exit(1)
}
for (const suite of results.suites ?? []) {
    console.log(`${suite.failed ? "✗" : "✓"} ${suite.name} — ${suite.passed}/${suite.total}`)
    for (const test of suite.tests ?? []) if (test.status === "fail") console.log(`    ✗ ${test.name}\n      ${test.error}`)
}
console.log(`\nBrowser conformance: ${results.passed}/${results.total} clauses green${results.failed ? ` — ${results.failed} RED` : ""}`)
process.exit(results.failed === 0 && results.passed > 0 ? 0 : 1)
