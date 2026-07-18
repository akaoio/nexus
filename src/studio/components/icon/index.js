/**
 * <nx-icon name="…"> — Bootstrap Icons, the akao way (ui-icon): a registry of
 * REAL bootstrap-icons SVG bodies (icons.js, vendored by script — never emoji,
 * never hand-drawn), sized by the --icon token, colored by currentColor.
 * akao triad: logic here, template/styles/registry in their own files.
 */

import { render } from "../../../core/UI.js"
import { ICONS } from "./icons.js"
import { iconTemplate } from "./template.js"

export class NxIcon extends HTMLElement {
    static observedAttributes = ["name"]

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        render(iconTemplate(this), this.shadowRoot)
    }

    connectedCallback() {
        this.#paint()
    }

    attributeChangedCallback() {
        this.#paint()
    }

    #paint() {
        if (!this.$svg) return
        const name = this.getAttribute("name")
        const body = ICONS[name]
        // registry first (inline, instant); ANY other bootstrap-icons name
        // resolves through the vendored sprite — the whole set, dev's choice
        this.$svg.innerHTML = body ?? (name ? `<use href="/_nexus/vendor/bootstrap-icons/bootstrap-icons.svg#${name}"></use>` : "")
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-icon")) customElements.define("nx-icon", NxIcon)

export default NxIcon
