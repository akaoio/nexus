/**
 * Worker fixture for the Threads kernel tests — built on the kernel's own
 * Thread base class (the protocol is dogfooded, not simulated).
 */

import Thread from "../../../src/kernel/Thread.js"

class Echo extends Thread {
    echo(params) {
        return params
    }

    boom() {
        throw new Error("boom")
    }

    delayed(params) {
        return new Promise((resolve) => setTimeout(() => resolve(params), 10))
    }

    /** No-queue invocation result → arrives at the manager as a broadcast. */
    announce(params) {
        return { announced: params }
    }

    /** Ask a sibling thread through the manager relay and await its answer. */
    askSibling(params) {
        return new Promise((resolve, reject) => {
            this.queue({
                thread: params.thread,
                method: "echo",
                params: params.payload,
                callback: (response, error) => (error ? reject(new Error(error.message || String(error))) : resolve(response))
            })
        })
    }
}

new Echo()
