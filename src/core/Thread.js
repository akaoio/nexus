/**
 * Thread base class for consistent behavior across all threads (main and
 * workers), for both Node.js worker_threads and browser Web Workers.
 * Extracted from akao src/core/Thread.js with two decouplings:
 *
 *  - akao's Construct.Site() bootstrap is gone; `ready` simply awaits the
 *    subclass's optional init(). App-specific construction belongs to the app.
 *  - A no-queue method result is sent as { broadcast: <result> } instead of
 *    akao's { Lives: ... } global-state channel. The Threads manager exposes
 *    an onbroadcast hook; akao layers its Lives merge on top when it migrates.
 *
 * Message protocol (the contract, shared with Threads.js):
 *   inbound : { queue?, method, params }          — invoke a method
 *   inbound : { queue, response | error }         — reply routed back to us
 *   outbound: { queue, response | error }         — reply to an invocation
 *   outbound: { relay: { thread, method, params, queue? } } — ask the manager
 *   outbound: { broadcast: <data> }               — no-queue result broadcast
 */

import { NODE, isPromise, clone, randomKey } from "./Utils.js"

export default class Thread {
    // Configuration object for this thread
    configs = {}

    // Local queue callbacks for responses routed back from the thread manager
    queues = {}

    // Flag to track initialization state
    initialized = false

    error(error) {
        if (!error) return { message: "Unknown error" }
        if (typeof error === "string") return { message: error }
        return {
            name: error.name,
            message: error.message || String(error),
            stack: error.stack
        }
    }

    constructor() {
        // Set up global error handlers to prevent process exit
        if (NODE) {
            process.on("uncaughtException", (error) => {
                console.error("Uncaught Exception:", error)
            })
            process.on("unhandledRejection", (reason, promise) => {
                console.error("Unhandled Rejection at:", promise, "reason:", reason)
            })
        } else {
            globalThis.onerror = (message, source, lineno, colno, error) => {
                console.error("Global Error:", error || message)
                return true
            }
            globalThis.onunhandledrejection = (event) => {
                console.error("Unhandled Rejection:", event.reason)
                event.preventDefault()
            }
        }

        // Set up message handlers for receiving messages from the parent thread
        // Browser Web Worker: listens for messages from main thread
        if (typeof onmessage !== "undefined") onmessage = (event) => this.process(event.data)
        // Node.js worker thread: set up parent port listener
        if (NODE)
            import("worker_threads").then(({ parentPort }) => {
                if (!parentPort) return
                this.parent = parentPort
                this.parent.on("message", (data) => this.process(data))
            })

        // Run the subclass's optional init()
        this.ready = Promise.resolve().then(async () => {
            if (typeof this?.init === "function") await this.init()
            this.initialized = true
            return this
        })
    }

    /**
     * Process an incoming message: either a routed-back reply for one of our
     * queued asks, or an invocation of one of our methods.
     */
    process(data = {}) {
        const queue = data?.queue

        if (queue && this.queues?.[queue] && ("response" in data || "error" in data)) {
            const callback = this.queues[queue]
            delete this.queues[queue]
            if (typeof callback === "function") callback(data?.response, data?.error)
            return
        }

        const method = data?.method
        const params = data?.params
        if (!method) return
        if (typeof this?.[method] !== "function") {
            const error = { message: `Method not found: ${method}` }
            console.error(error.message)
            if (queue) this.send({ queue, error })
            return
        }

        try {
            const result = this[method](params, data)

            if (!queue) {
                if (result !== undefined) this.send({ broadcast: clone(result) })
                return
            }

            if (isPromise(result))
                return result
                    .then((response) => this.send({ queue, response: clone(response) }))
                    .catch((error) => {
                        this.send({ queue, error: this.error(error) })
                    })

            this.send({ queue, response: clone(result) })
        } catch (error) {
            if (queue) this.send({ queue, error: this.error(error) })
            else console.error(error)
        }
    }

    /** Fire-and-forget a method on a sibling thread via the manager. */
    call({ thread, method, params, transfer } = {}) {
        if (!thread || !method) return
        this.send({ relay: { thread, method, params, transfer } }, transfer)
    }

    /** Ask a sibling thread via the manager; callback receives (response, error). */
    queue({ thread, method, params, callback, transfer } = {}) {
        if (!thread || !method) return
        const queue = randomKey()
        if (typeof callback === "function") this.queues[queue] = callback
        this.send({ relay: { thread, method, params, queue, transfer } }, transfer)
        return queue
    }

    /** Send data to the parent (main) thread on either platform. */
    async send(data = {}, transfer = []) {
        if (!data) return
        if (NODE && !this.parent) {
            const { parentPort } = await import("worker_threads")
            if (!parentPort) return
            this.parent = parentPort
        }
        const send = typeof postMessage === "function" ? postMessage.bind(globalThis) : this?.parent?.postMessage.bind(this.parent)
        if (!send) throw new Error("No postMessage function found")
        if (Array.isArray(transfer) && transfer.length) send(data, transfer)
        else send(data)
    }
}

export { Thread }
