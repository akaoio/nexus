/**
 * Kernel conformance — STATES (KRN-ST).
 * Pins the reactive-state contract: proxy-based writes, deep-equality change
 * detection, key/path/global subscriptions, property-assignment subscribers.
 */

import Test, { assert } from "../../src/core/Test.js"
import States from "../../src/core/States.js"
import Context from "../../src/core/Context.js"

Test.describe("Kernel — states (KRN-ST)", () => {
    Test.it("KRN-ST01 set/get round-trips strings, arrays-as-paths and objects", () => {
        const s = new States({})
        s.set({ user: { name: "alice", tags: ["a"] }, count: 1 })
        assert.equal(s.get("count"), 1)
        assert.equal(s.get(["user", "name"]), "alice")
        assert.deepEqual(s.get({ count: null }), { count: 1 })
    })

    Test.it("KRN-ST02 set(string) flags true; set(array) flags each true", () => {
        const s = new States({})
        s.set("ready")
        s.set(["a", "b"])
        assert.equal(s.get("ready"), true)
        assert.equal(s.get("a"), true)
        assert.equal(s.get("b"), true)
    })

    Test.it("KRN-ST03 key subscribers receive { key, value, last }", () => {
        const s = new States({ theme: "light" })
        let seen = null
        s.on("theme", (data) => (seen = data))
        s.set({ theme: "dark" })
        assert.equal(seen.key, "theme")
        assert.equal(seen.value, "dark")
        assert.equal(seen.last, "light")
    })

    Test.it("KRN-ST04 deep-equal re-set does NOT notify (change detection)", () => {
        const s = new States({ user: { name: "alice" } })
        let count = 0
        s.on("user", () => count++)
        s.set({ user: { name: "alice" } }) // deep-equal → silent
        assert.equal(count, 0)
        s.set({ user: { name: "bob" } })
        assert.equal(count, 1)
    })

    Test.it("KRN-ST05 global subscribers hear every change", () => {
        const s = new States({})
        const keys = []
        s.on((data) => keys.push(data.key))
        s.set({ a: 1, b: 2 })
        assert.deepEqual(keys, ["a", "b"])
    })

    Test.it("KRN-ST06 path subscription narrows to a nested value", () => {
        const s = new States({})
        let city = null
        s.on(["address", "city"], (data) => (city = data.value))
        s.set({ address: { city: "hanoi", zip: "10000" } })
        assert.equal(city, "hanoi")
    })

    Test.it("KRN-ST07 immediate flag calls the subscriber with the current value", () => {
        const s = new States({ theme: "dark" })
        let seen = null
        s.on("theme", (data) => (seen = data), true)
        assert.equal(seen.value, "dark")
    })

    Test.it("KRN-ST08 the returned off() unsubscribes", () => {
        const s = new States({})
        let count = 0
        const off = s.on("x", () => count++)
        s.set({ x: 1 })
        off()
        s.set({ x: 2 })
        assert.equal(count, 1)
    })

    Test.it("KRN-ST09 property-assignment subscribers mirror state into a target object", () => {
        const s = new States({ theme: "light" })
        const view = {}
        s.on("theme", [view, "theme"])
        assert.equal(view.theme, "light") // initial assignment on subscribe
        s.set({ theme: "dark" })
        assert.equal(view.theme, "dark")
    })

    Test.it("KRN-ST10 del removes the key; GLOBAL subscribers hear it, key subscribers stay silent", () => {
        // akao semantics, pinned: notify() skips key/path subscribers when the
        // value becomes undefined (protects [target, prop] mirror subscribers);
        // only global subscribers observe deletions.
        const s = new States({ tmp: 1 })
        let global = null
        let keyed = null
        s.on((data) => (global = data))
        s.on("tmp", (data) => (keyed = data))
        s.del("tmp")
        assert.equal(s.has("tmp"), false)
        assert.equal(global.key, "tmp")
        assert.equal(global.value, undefined)
        assert.equal(global.last, 1)
        assert.equal(keyed, null)
    })

    Test.it("KRN-ST11 clear(key) drops every subscriber of that key", () => {
        const s = new States({})
        let count = 0
        s.on("x", () => count++)
        s.clear("x")
        s.set({ x: 1 })
        assert.equal(count, 0)
    })

    Test.it("KRN-ST12 the kernel Context is one global, empty-by-default States instance", () => {
        assert.truthy(Context instanceof States)
        assert.equal(Context, globalThis.Context)
        Context.set({ __probe: 1 })
        assert.equal(Context.get("__probe"), 1)
        Context.del("__probe")
    })
})
