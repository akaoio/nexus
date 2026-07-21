/**
 * Cancelling a queued call (THR-CANCEL-*) — the missing half of the Threads
 * queue API, and the mechanism issue #9's I6 needed.
 *
 * `queue()` already returns its queue id, but nothing could ever give one
 * back: an entry left `queues` only when a reply arrived. A caller that gave
 * up — a timeout is the obvious one — left its entry there forever.
 */

import Test, { assert } from "../../src/core/Test.js"
import { Threads } from "../../src/core/Threads.js"

/** A thread that accepts messages and never answers. */
const silent = () => ({ postMessage() {}, removeAllListeners() {}, terminate() {} })

Test.describe("Threads queue cancellation (THR-CANCEL)", () => {

    Test.it("THR-CANCEL-01 cancel() removes the entry, reports whether one existed, and is safe to repeat", () => {
        const threads = new Threads()
        threads.threads["worker"] = silent()

        const queue = threads.queue({ thread: "worker", method: "run", params: {}, callback: () => {} })
        assert.truthy(queue, "queue() hands back the id precisely so it can be given back")
        assert.truthy(threads.queues[queue], "the entry is pending")

        assert.equal(threads.cancel(queue), true, "cancelling a live entry reports that it was there")
        assert.falsy(threads.queues[queue], "and the entry is gone")

        assert.equal(threads.cancel(queue), false, "cancelling twice is not an error, it is simply nothing to do")
        assert.equal(threads.cancel(undefined), false)
    })

    Test.it("THR-CANCEL-02 a late reply to a cancelled queue is DROPPED, not delivered to a caller that gave up", () => {
        const threads = new Threads()
        threads.threads["worker"] = silent()

        let calls = 0
        const queue = threads.queue({ thread: "worker", method: "run", params: {}, callback: () => calls++ })
        threads.cancel(queue)

        // The worker finally answers — after the caller has already been told
        // the call failed. Delivering it now would settle a promise twice and
        // resurrect work the runner has already retried.
        threads.process({ queue, response: "too late" }, "worker")
        assert.equal(calls, 0)
    })
})
