/**
 * Kernel conformance — THREADS (KRN-TH).
 * Pins the isomorphic thread protocol with REAL Node worker_threads running
 * the kernel's own Thread base class (test/kernel/fixtures/echo.js) — the
 * protocol is exercised end-to-end, not simulated.
 */

import Test, { assert } from "../../src/kernel/Test.js"
import Threads from "../../src/kernel/Threads.js"

const FIXTURE = new URL("./fixtures/echo.js", import.meta.url)

/** Promise wrapper over the callback-based queue API. */
const ask = (manager, thread, method, params, timeout = 3000) =>
    new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`timeout asking ${thread}.${method}`)), timeout)
        manager.queue({
            thread,
            method,
            params,
            callback: (response, error) => {
                clearTimeout(timer)
                if (error) reject(new Error(error.message || String(error)))
                else resolve(response)
            }
        })
    })

Test.describe("Kernel — threads (KRN-TH)", () => {
    Test.it("KRN-TH01 register + queue round-trips params through a real worker", async () => {
        const manager = new Threads()
        await manager.register("echo", { worker: true, url: FIXTURE })
        const response = await ask(manager, "echo", "echo", { x: 1, nested: { ok: true } })
        assert.deepEqual(response, { x: 1, nested: { ok: true } })
        await manager.terminate("echo")
    })

    Test.it("KRN-TH02 a throwing method routes back an error, not a response", async () => {
        const manager = new Threads()
        await manager.register("echo", { worker: true, url: FIXTURE })
        await Test.assert.rejects(ask(manager, "echo", "boom", {}), "boom")
        await manager.terminate("echo")
    })

    Test.it("KRN-TH03 async (promise-returning) methods resolve through the queue", async () => {
        const manager = new Threads()
        await manager.register("echo", { worker: true, url: FIXTURE })
        const response = await ask(manager, "echo", "delayed", { late: true })
        assert.deepEqual(response, { late: true })
        await manager.terminate("echo")
    })

    Test.it("KRN-TH04 an unknown method routes back a Method-not-found error", async () => {
        const manager = new Threads()
        await manager.register("echo", { worker: true, url: FIXTURE })
        await Test.assert.rejects(ask(manager, "echo", "nope", {}), "Method not found")
        await manager.terminate("echo")
    })

    Test.it("KRN-TH05 no-queue results arrive via the onbroadcast hook (decoupled Lives channel)", async () => {
        const manager = new Threads()
        await manager.register("echo", { worker: true, url: FIXTURE })
        const broadcast = new Promise((resolve) => (manager.onbroadcast = (data, source) => resolve({ data, source })))
        manager.call({ thread: "echo", method: "announce", params: { hello: 1 } })
        const { data, source } = await broadcast
        assert.deepEqual(data, { announced: { hello: 1 } })
        assert.equal(source, "echo")
        await manager.terminate("echo")
    })

    Test.it("KRN-TH06 worker-to-worker relay routes an answer back through the manager", async () => {
        const manager = new Threads()
        await manager.register("alpha", { worker: true, url: FIXTURE })
        await manager.register("beta", { worker: true, url: FIXTURE })
        const response = await ask(manager, "alpha", "askSibling", { thread: "beta", payload: { via: "relay" } })
        assert.deepEqual(response, { via: "relay" })
        await manager.terminate("alpha")
        await manager.terminate("beta")
    })

    Test.it("KRN-TH07 relaying to an unknown thread returns a Thread-not-found error", async () => {
        const manager = new Threads()
        await manager.register("alpha", { worker: true, url: FIXTURE })
        await Test.assert.rejects(
            ask(manager, "alpha", "askSibling", { thread: "ghost", payload: {} }),
            "Thread not found"
        )
        await manager.terminate("alpha")
    })
})
