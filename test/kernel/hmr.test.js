/**
 * Kernel conformance — HMR (KRN-HM).
 *
 * The HMR runtime is dev-browser-only by design (gated on DEV). In Node the
 * module must import silently and export the inert stub. Runtime behavior
 * (define interception, module swapping) is browser-marked — the browser
 * runner executes on localhost, where DEV is true.
 */

import Test, { assert } from "../../src/kernel/Test.js"
import hmr from "../../src/kernel/HMR.js"

Test.describe("Kernel — HMR (KRN-HM)", () => {
    Test.it("KRN-HM01 in Node the module imports safely and exports the inert stub", () => {
        assert.equal(typeof hmr, "object")
        assert.equal(hmr.handle, undefined) // no runtime outside DEV browsers
    })
})

Test.describe("Kernel — HMR runtime (KRN-HM, browser)", () => {
    Test.it("KRN-HM10 the DEV runtime exposes the update surface and registers on window", () => {
        for (const method of ["handle", "apply", "resolve", "reg", "accept", "dispose"])
            assert.equal(typeof hmr[method], "function", method)
        assert.equal(window.hmr, hmr)
    })

    Test.it("KRN-HM11 customElements.define is intercepted — tag→module tracked for hot swap", () => {
        const tag = `x-hmr-probe-${Date.now()}`
        class Probe extends HTMLElement {}
        Probe._module = "https://localhost/components/hmr-probe/index.js"
        customElements.define(tag, Probe)
        const tracked = hmr.elements.get(tag)
        assert.truthy(tracked)
        assert.equal(tracked.class, Probe)
        assert.equal(tracked.module, "https://localhost/components/hmr-probe/index.js")
    })

    Test.it("KRN-HM12 resolve() normalizes relative and src/ paths to origin URLs", () => {
        const origin = window.location.origin
        assert.equal(hmr.resolve("./components/x/index.js"), `${origin}/components/x/index.js`)
        assert.equal(hmr.resolve("src/components/x/index.js"), `${origin}/components/x/index.js`)
        assert.equal(hmr.resolve("https://cdn.example/x.js"), "https://cdn.example/x.js")
    })
}, { browser: true })
