/**
 * Thread manager for coordinating multiple threads (main thread, worker
 * threads) — isomorphic: Web Workers in the browser, worker_threads in Node.
 * Handles registration, message routing, queue management and relaying.
 * Extracted from akao src/core/Threads.js with two decouplings:
 *
 *  - The hardcoded Lives global-state merge is replaced by an overridable
 *    onbroadcast(data, source) hook — the app decides what broadcasts mean.
 *  - terminate(name) added so owners can stop workers deterministically.
 */

import { NODE, randomKey } from "./Utils.js"

export class Threads {
    // Map of registered threads by name
    threads = {}

    // Maps queue IDs to callback functions (or routing records) for async responses
    queues = {}

    /** Overridable: receives no-queue broadcasts from worker threads. */
    onbroadcast = null

    /**
     * Register a new thread (main or worker).
     * Creates Web Workers in the browser or worker_threads workers in Node.
     * @param {string} name - Unique identifier for the thread
     * @param {Object} configs - { main: boolean } | { worker: boolean, url?: URL, path?: string }
     * @returns {Promise|Worker} Module promise (main) or worker instance
     */
    async register(name, configs = {}) {
        if (this.threads[name]) return this.threads[name]

        const url = configs?.url || new URL(configs?.path || `./threads/${name}.js`, import.meta.url)
        // Main thread: import the module directly
        if (configs?.main) this.threads[name] = import(url.href)
        // Worker thread: create a new Worker
        else if (configs?.worker) {
            let $Worker = typeof Worker !== "undefined" ? Worker : NODE && typeof Worker === "undefined" ? (await import("worker_threads"))?.Worker : undefined
            if (typeof $Worker === "undefined") throw new Error("Worker class not found")
            this.threads[name] = new $Worker(url, configs)

            if (NODE) {
                this.threads[name].on("error", (error) => console.error(`Worker ${name} error:`, error))
                this.threads[name].on("exit", (code) => {
                    if (code !== 0) console.error(`Worker ${name} stopped with exit code ${code}`)
                })
                this.threads[name].on("message", (data) => this.process(data, name))
            } else {
                this.threads[name].onerror = (error) => console.error(`Worker ${name} error:`, error)
                this.threads[name].onmessage = (event) => this.process(event?.data, name)
            }
        }
        return this.threads[name]
    }

    /** Stop a worker thread and forget it. Safe to call on unknown names. */
    async terminate(name) {
        const thread = this.threads?.[name]
        if (!thread) return false
        delete this.threads[name]
        // Deliberate termination: silence the exit-code listener first
        if (typeof thread.removeAllListeners === "function") thread.removeAllListeners("exit")
        if (typeof thread.terminate === "function") await thread.terminate()
        return true
    }

    post(name, data, transfer = []) {
        if (!name || !data || !this.threads?.[name]) return false
        if (Array.isArray(transfer) && transfer.length) this.threads[name].postMessage(data, transfer)
        else this.threads[name].postMessage(data)
        return true
    }

    /** Route a relay request from one thread to another, tracking the queue. */
    relay({ source, thread, method, params, queue, transfer } = {}) {
        if (!thread || !method) return

        if (!this.threads?.[thread]) {
            const error = { message: `Thread not found: ${thread}` }
            console.error(error.message)
            if (!queue) return
            if (source && this.threads?.[source]) this.post(source, { queue, error })
            else if (typeof this.queues?.[queue] === "function") {
                this.queues[queue](undefined, error)
                delete this.queues[queue]
            }
            return
        }

        if (queue && source) this.queues[queue] = { thread: source }
        this.post(thread, { queue, method, params, source }, transfer)
    }

    /**
     * Process an incoming message from a worker: a relay request, a broadcast,
     * or a queued response to route to its waiting callback or source thread.
     */
    process(data, source) {
        if (typeof data !== "object") return
        if (data?.relay) return this.relay({ source, ...data.relay })
        if ("broadcast" in (data ?? {})) {
            if (typeof this.onbroadcast === "function") this.onbroadcast(data.broadcast, source)
            return
        }

        const queue = data?.queue
        if (!queue || !this.queues?.[queue]) return
        if (typeof this.queues[queue] == "function") this.queues[queue](data?.response, data?.error)
        else if (this.queues[queue]?.thread) this.post(this.queues[queue].thread, { queue, response: data?.response, error: data?.error, source })
        delete this.queues[queue]
    }

    /**
     * Queue a method call on a thread with a callback for the response.
     * @param {Object} options - { thread, method, params, callback, transfer }
     */
    queue({ thread, method, params, callback, transfer }) {
        if (!thread || !this.threads?.[thread]) return
        const queue = randomKey()
        if (this.queues?.[queue]) return this.queues[queue]
        if (typeof callback == "function") this.queues[queue] = callback
        this.post(thread, { queue, method, params }, transfer)
        return queue
    }

    /**
     * Abandon a queued call: forget its entry, so any reply arriving later is
     * dropped. The missing half of `queue()`, which already hands back its id
     * precisely so it can be given back.
     *
     * Without this an entry left `queues` only when a reply ARRIVED — so a
     * caller that gave up (a timeout being the obvious case) leaked its entry
     * forever, and a worker that eventually answered would settle a promise
     * whose owner had long since moved on.
     *
     * @returns {boolean} whether there was an entry to cancel
     */
    cancel(queue) {
        if (!queue || !this.queues?.[queue]) return false
        delete this.queues[queue]
        return true
    }

    /** Call a method on a thread without waiting for a response. */
    call({ thread, method, params, transfer }) {
        if (!thread || !method || !this.threads?.[thread]) return
        this.post(thread, { method, params }, transfer)
    }
}

export default Threads

// Create or reuse global Threads singleton for app-wide thread management
globalThis.threads = globalThis.threads || new Threads()

// Export the global threads instance for convenient access throughout the app
export const threads = globalThis.threads
