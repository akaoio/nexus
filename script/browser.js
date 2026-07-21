/**
 * Driving a real headless Chromium over raw CDP — extracted so the two runners
 * that need a browser share ONE implementation rather than each carrying a
 * copy that drifts (`script/test-browser.js` runs the { browser: true }
 * clauses against static files; `script/test-e2e.js` drives a live
 * `nexus dev`). Zero dependencies: Node's built-in WebSocket, no puppeteer.
 *
 * `--dump-dom` was tried first and abandoned — modern headless_shell builds
 * emit nothing for http:// URLs.
 */

import { spawn } from "child_process"
import { existsSync, readdirSync, mkdtempSync, rmSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"

/** Purpose-built headless shells first, then ordinary installs. */
export function findBrowsers() {
    const candidates = []
    if (process.env.NEXUS_BROWSER) candidates.push(process.env.NEXUS_BROWSER)
    const playwright = join(process.env.HOME ?? "", ".cache", "ms-playwright")
    if (existsSync(playwright)) {
        const dirs = readdirSync(playwright).sort().reverse()
        for (const dir of dirs.filter((d) => d.startsWith("chromium_headless_shell")))
            candidates.push(
                join(playwright, dir, "chrome-headless-shell-linux", "headless_shell"),
                join(playwright, dir, "chrome-linux", "headless_shell")
            )
        for (const dir of dirs.filter((d) => d.startsWith("chromium-")))
            candidates.push(join(playwright, dir, "chrome-linux", "chrome"))
    }
    candidates.push("/usr/bin/chromium", "/usr/bin/chromium-browser", "/usr/bin/google-chrome")
    for (const base of [process.env["ProgramFiles"], process.env["ProgramFiles(x86)"], process.env.LOCALAPPDATA])
        if (base)
            candidates.push(
                join(base, "Google", "Chrome", "Application", "chrome.exe"),
                join(base, "Microsoft", "Edge", "Application", "msedge.exe")
            )
    return candidates.filter((c) => existsSync(c))
}

/** Minimal flat-protocol CDP client over Node's built-in WebSocket. */
export function cdp(endpoint) {
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

/**
 * Launch a browser on `url` and hand back a page handle.
 *
 * `evaluate` awaits promises in the page, so a caller can `await import(…)` a
 * real module from the running app — which is how an E2E assertion reaches
 * live module state (a subscriber count, say) instead of guessing at it from
 * the DOM.
 *
 * @returns {Promise<{evaluate, navigate, close}>}
 */
export async function launch(binary, url, { timeoutMs = 20000 } = {}) {
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

    const endpoint = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("browser did not announce DevTools")), timeoutMs)
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

    const evaluate = async (expression) => {
        const { result, exceptionDetails } = await client.send(
            "Runtime.evaluate",
            { expression, returnByValue: true, awaitPromise: true },
            sessionId
        )
        if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text)
        return result.value
    }

    const navigate = async (to) => {
        await client.send("Page.navigate", { url: to }, sessionId)
    }

    const close = async () => {
        try { client.close() } catch {}
        await new Promise((resolve) => {
            child.once("exit", resolve)
            child.kill()
        })
        // Never let profile cleanup mask the run's actual result.
        try { rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }) } catch {}
    }

    return { evaluate, navigate, close }
}

export default { findBrowsers, cdp, launch }
