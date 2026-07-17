/**
 * Kernel conformance — EVENTS (KRN-EV).
 * Pins the isomorphic event bus contract: payload always arrives as
 * { detail } regardless of platform.
 */

import Test, { assert } from "../../src/core/Test.js"
import Events, { events } from "../../src/core/Events.js"

Test.describe("Kernel — events (KRN-EV)", () => {
    Test.it("KRN-EV01 emit delivers the payload as { detail } to listeners", () => {
        const bus = new Events()
        let received = null
        bus.on("ping", (e) => (received = e.detail))
        bus.emit("ping", { x: 1 })
        assert.deepEqual(received, { x: 1 })
    })

    Test.it("KRN-EV02 on() returns an unsubscribe function that stops delivery", () => {
        const bus = new Events()
        let count = 0
        const off = bus.on("tick", () => count++)
        bus.emit("tick")
        off()
        bus.emit("tick")
        assert.equal(count, 1)
    })

    Test.it("KRN-EV03 once() fires exactly once", () => {
        const bus = new Events()
        let count = 0
        bus.once("tick", () => count++)
        bus.emit("tick")
        bus.emit("tick")
        assert.equal(count, 1)
    })

    Test.it("KRN-EV04 off() removes a specific listener, leaving others", () => {
        const bus = new Events()
        let a = 0
        let b = 0
        const la = () => a++
        bus.on("tick", la)
        bus.on("tick", () => b++)
        bus.off("tick", la)
        bus.emit("tick")
        assert.equal(a, 0)
        assert.equal(b, 1)
    })

    Test.it("KRN-EV05 instances are isolated; a global singleton bus exists", () => {
        const one = new Events()
        const two = new Events()
        let leaked = 0
        two.on("tick", () => leaked++)
        one.emit("tick")
        assert.equal(leaked, 0)
        assert.truthy(events instanceof Events)
        assert.equal(events, globalThis.events)
    })
})
