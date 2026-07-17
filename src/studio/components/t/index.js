/**
 * <nx-t data-key="save"> — declarative dictionary text, the akao ui-context
 * pattern: the element renders the translation for its key and re-renders
 * REACTIVELY when the locale changes. No t() calls sprinkled through logic —
 * text is data bound in templates (dictionary keys), exactly once.
 *
 *   NxT.bundle({ dict, locale })   ← the boot payload + chosen locale
 *   NxT.setLocale("vi")            ← every mounted <nx-t> re-renders
 *
 * data-fallback carries the English fallback for keys outside the dictionary.
 */

import { render } from "../../../kernel/UI.js"
import { tTemplate } from "./template.js"

const mounted = new Set()
let dict = {}
let locale = "en"

export class NxT extends HTMLElement {
    static observedAttributes = ["data-key", "data-fallback"]

    /** Install the translation memory + active locale (boot). */
    static bundle(next) {
        dict = next.dict ?? {}
        locale = next.locale ?? "en"
        for (const el of mounted) el.paint()
    }

    /** Switch locale — every mounted element repaints. */
    static setLocale(code) {
        locale = code
        for (const el of mounted) el.paint()
    }

    static get locale() {
        return locale
    }

    /** Resolve a key programmatically (toasts, confirm messages). */
    static resolve(key, fallback) {
        const entry = dict[key]
        const value = entry && (entry[locale] != null ? entry[locale] : entry.en)
        return value != null ? value : fallback != null ? fallback : key
    }

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        render(tTemplate(this), this.shadowRoot)
    }

    connectedCallback() {
        mounted.add(this)
        this.paint()
    }

    disconnectedCallback() {
        mounted.delete(this)
    }

    attributeChangedCallback() {
        this.paint()
    }

    paint() {
        if (this.$text) this.$text.textContent = NxT.resolve(this.dataset.key, this.dataset.fallback)
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-t")) customElements.define("nx-t", NxT)

export default NxT
