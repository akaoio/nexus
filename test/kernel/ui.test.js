/**
 * Kernel conformance — UI ENGINE (KRN-UI).
 *
 * html() is pure string work and is pinned fully in Node — it is the
 * contract between templates and render(). render()/css()/Component need a
 * real DOM: those clauses are marked { browser: true } (skipped in Node,
 * executed by the browser runner — akao's /test route pattern).
 */

import Test, { assert } from "../../src/kernel/Test.js"
import { html, css, render, Component } from "../../src/kernel/UI.js"

Test.describe("Kernel — UI html() (KRN-UI)", () => {
    Test.it("KRN-UI01 html returns a TemplateResult { strings, values, html, _isTemplateResult }", () => {
        const t = html`<div>hello</div>`
        assert.equal(t._isTemplateResult, true)
        assert.equal(typeof t.html, "string")
        assert.truthy(Array.isArray(t.strings))
        assert.truthy(Array.isArray(t.values))
    })

    Test.it("KRN-UI02 primitives embed directly into the html string — no markers", () => {
        const name = "alice"
        const t = html`<div>${name} is ${30} · ${true}</div>`
        assert.equal(t.html, "<div>alice is 30 · true</div>")
        assert.deepEqual(t.values, [])
    })

    Test.it("KRN-UI03 null/undefined embed as empty text", () => {
        const t = html`<p>${null}${undefined}</p>`
        assert.equal(t.html, "<p></p>")
    })

    Test.it("KRN-UI04 nested TemplateResults become comment markers and land in values", () => {
        const inner = html`<span>world</span>`
        const outer = html`<div>hello ${inner}</div>`
        assert.equal(outer.html, "<div>hello <!--__mark:0--></div>")
        assert.equal(outer.values.length, 1)
        assert.equal(outer.values[0], inner)
    })

    Test.it("KRN-UI05 arrays become comment markers (items.map pattern)", () => {
        const items = [1, 2, 3].map((i) => html`<li>${i}</li>`)
        const t = html`<ul>${items}</ul>`
        assert.equal(t.html, "<ul><!--__mark:0--></ul>")
        assert.equal(t.values[0].length, 3)
    })

    Test.it("KRN-UI06 functions in attribute position get __attr_mark; in content position a comment marker", () => {
        const onclick = () => {}
        const button = html`<button onclick=${onclick}>go</button>`
        assert.equal(button.html.includes("__attr_mark:0__"), true)
        const content = html`<div>${onclick}</div>`
        assert.equal(content.html, "<div><!--__mark:0--></div>")
    })

    Test.it("KRN-UI07 self-closing custom elements expand; native void elements stay untouched", () => {
        const t = html`<ui-icon name="x" /><br/>`
        assert.equal(t.html.includes("<ui-icon name=\"x\" ></ui-icon>"), true)
        assert.equal(t.html.includes("<br/>"), true)
    })

    Test.it("KRN-UI08 static templates are cached by call site — same object back", () => {
        const make = () => html`<p>static</p>`
        assert.equal(make(), make())
    })

    Test.it("KRN-UI09 whitespace between tags collapses", () => {
        const t = html`<div>
            <span>a</span>
        </div>`
        assert.equal(t.html, "<div><span>a</span></div>")
    })

    Test.it("KRN-UI10 the UI façade is importable in Node — every export defined", () => {
        assert.equal(typeof html, "function")
        assert.equal(typeof css, "function")
        assert.equal(typeof render, "function")
        assert.equal(typeof Component, "function")
    })
})

Test.describe("Kernel — UI render()/css()/Component (KRN-UI, browser)", () => {
    Test.it("KRN-UI20 render replaces container children by default; append/prepend honour order", () => {
        const div = document.createElement("div")
        render(html`<p>one</p>`, div)
        assert.equal(div.innerHTML, "<p>one</p>")
        render(html`<p>two</p>`, div, { append: true })
        assert.equal(div.querySelectorAll("p").length, 2)
        render(html`<p>zero</p>`, div, { prepend: true })
        assert.equal(div.firstChild.textContent, "zero")
    })

    Test.it("KRN-UI21 nested templates and arrays render recursively at their markers", () => {
        const div = document.createElement("div")
        const items = ["a", "b"].map((x) => html`<li>${x}</li>`)
        render(html`<ul>${items}</ul><em>${html`<b>deep</b>`}</em>`, div)
        assert.equal(div.querySelectorAll("li").length, 2)
        assert.equal(div.querySelector("em b").textContent, "deep")
    })

    Test.it("KRN-UI22 attribute callbacks fire after mount with the live element", () => {
        // Convention: the function stands BARE in attribute position —
        // <button ${fn}> — and receives the mounted element after render.
        const div = document.createElement("div")
        let element = null
        render(html`<button ${({ element: el }) => (element = el)}>go</button>`, div)
        assert.equal(element, div.querySelector("button"))
    })

    Test.it("KRN-UI23 css() returns a style element with the composed text", () => {
        const style = css`p { color: red; }`
        assert.equal(style.nodeName, "STYLE")
        assert.equal(style.innerHTML.includes("color: red"), true)
    })

    Test.it("KRN-UI24 Component cleans up listen/watch subscriptions on disconnect", () => {
        class Probe extends Component {}
        customElements.define(`x-probe-${Date.now()}`, Probe)
        const probe = new Probe()
        let calls = 0
        probe.listen(document.body, "x-ping", () => calls++)
        document.body.appendChild(probe)
        document.body.dispatchEvent(new CustomEvent("x-ping"))
        probe.remove() // disconnectedCallback → cleanup
        document.body.dispatchEvent(new CustomEvent("x-ping"))
        assert.equal(calls, 1)
        assert.equal(probe.subs.length, 0)
    })
}, { browser: true })
