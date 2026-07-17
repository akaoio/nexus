/**
 * Kernel conformance — ENVIRONMENT & UTILS (KRN-EN, KRN-UT).
 * Pins the pure utility behavior the rest of the kernel depends on.
 */

import Test, { assert } from "../../src/core/Test.js"
import { detectEnvironment, NODE, BROWSER } from "../../src/core/environment.js"
import { clone, diff, merge, isPromise, randomInt, randomText, randomKey, now } from "../../src/core/Utils.js"

Test.describe("Kernel — environment (KRN-EN)", () => {
    Test.it("KRN-EN01 detects Node.js when process.versions.node exists", () => {
        assert.equal(NODE, true)
        assert.equal(BROWSER, false)
    })

    Test.it("KRN-EN02 detects a browser scope (location.origin, no process)", () => {
        const env = detectEnvironment({ location: { origin: "https://x.dev", hostname: "x.dev" } })
        assert.equal(env.BROWSER, true)
        assert.equal(env.NODE, false)
        assert.equal(env.DEV, false)
    })

    Test.it("KRN-EN03 flags DEV on localhost and WIN on win32", () => {
        const dev = detectEnvironment({ location: { origin: "http://localhost:8080", hostname: "localhost" } })
        assert.equal(dev.DEV, true)
        const win = detectEnvironment({ process: { versions: { node: "18" }, platform: "win32" } })
        assert.equal(win.WIN, true)
    })
})

Test.describe("Kernel — utils (KRN-UT)", () => {
    Test.it("KRN-UT01 clone copies deeply — mutating the copy never touches the source", () => {
        const source = { a: { b: [1, 2, { c: 3 }] } }
        const copy = clone(source)
        copy.a.b[2].c = 99
        assert.equal(source.a.b[2].c, 3)
    })

    Test.it("KRN-UT02 clone preserves circular references and strips functions", () => {
        const source = { fn: () => 1 }
        source.self = source
        const copy = clone(source)
        assert.equal(copy.self, copy)
        assert.falsy("fn" in copy)
    })

    Test.it("KRN-UT03 diff returns only the keys of b that differ, recursing into objects", () => {
        const a = { x: 1, nest: { keep: "same", change: "old" }, list: [1, 2] }
        const b = { x: 1, nest: { keep: "same", change: "new" }, list: [1, 3] }
        assert.deepEqual(diff(a, b), { nest: { change: "new" }, list: [1, 3] })
        assert.deepEqual(diff(a, a), {})
    })

    Test.it("KRN-UT04 merge deep-merges objects and overwrites arrays/scalars", () => {
        const a = { keep: 1, nest: { x: 1, y: 2 }, list: [1] }
        merge(a, { nest: { y: 3, z: 4 }, list: [9, 9] })
        assert.deepEqual(a, { keep: 1, nest: { x: 1, y: 3, z: 4 }, list: [9, 9] })
    })

    Test.it("KRN-UT05 isPromise detects thenables only", () => {
        assert.equal(isPromise(Promise.resolve()), true)
        assert.equal(isPromise({ then: () => {} }), true)
        assert.equal(isPromise({}), false)
        assert.equal(isPromise(null), false)
    })

    Test.it("KRN-UT06 randomInt stays in [min, max) and randomText honours length/charset", () => {
        for (let i = 0; i < 200; i++) assert.inRange(randomInt(5, 10), 5, 9)
        const text = randomText(16, "ab")
        assert.equal(text.length, 16)
        assert.truthy([...text].every((ch) => ch === "a" || ch === "b"))
    })

    Test.it("KRN-UT07 randomKey is time-sortable: base36 timestamp + 7 random chars", () => {
        const key = randomKey(1000000)
        assert.equal(key.slice(0, (1000000).toString(36).length), (1000000).toString(36))
        assert.equal(key.length, (1000000).toString(36).length + 7)
    })

    Test.it("KRN-UT08 now() returns the candle number for the interval", () => {
        const candle = now(60000)
        assert.equal(candle, Math.floor(Date.now() / 60000))
        assert.inRange(now(1) - Date.now(), -5, 5)
    })
})
