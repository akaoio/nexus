/**
 * <nx-context data-key="save"> — the akao ui-context primitive: dictionary-
 * bound text that re-renders REACTIVELY when the locale changes. Upgraded
 * with TEMPLATES: a dictionary value may carry {{0}}, {{1}}, … placeholders
 * filled from data-args (JSON array) — "{{0}} records" + [3] → "3 records".
 *
 *   NxContext.bundle({ dict, locale })  ← the boot payload + chosen locale
 *   NxContext.setLocale("vi")           ← every mounted element re-renders
 *   NxContext.resolve(key, fb, args)    ← programmatic strings (toasts…)
 */

import { render } from "../../../kernel/UI.js"
import { contextTemplate } from "./template.js"

const mounted = new Set()
let dict = {}
let locale = "en"

const fill = (text, args) =>
    args?.length ? String(text).replace(/\{\{(\d+)\}\}/g, (_, n) => (args[Number(n)] !== undefined ? String(args[Number(n)]) : "")) : String(text)

export class NxContext extends HTMLElement {
    static observedAttributes = ["data-key", "data-fallback", "data-args"]

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

    /** Resolve a key (+ template args) programmatically. */
    static resolve(key, fallback, args) {
        const entry = dict[key]
        const value = entry && (entry[locale] != null ? entry[locale] : entry.en)
        return fill(value != null ? value : fallback != null ? fallback : key, args)
    }

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        render(contextTemplate(this), this.shadowRoot)
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
        if (!this.$text) return
        let args
        try { args = this.dataset.args ? JSON.parse(this.dataset.args) : undefined } catch {}
        this.$text.textContent = NxContext.resolve(this.dataset.key, this.dataset.fallback, args)
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-context")) customElements.define("nx-context", NxContext)

export default NxContext
