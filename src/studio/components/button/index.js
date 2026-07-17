/**
 * <nx-button> — the akao BUTTON primitive as a Nexus triad: one shadow
 * <button>, content slotted, an optional leading icon via data-icon
 * (Bootstrap Icons through <nx-icon>), variants via data-variant
 * (primary | danger | icon), disabled reflected. Design once, use forever.
 */

import { render } from "../../../kernel/UI.js"
import { buttonTemplate } from "./template.js"

export class NxButton extends HTMLElement {
    static observedAttributes = ["disabled", "data-icon"]

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        render(buttonTemplate(this), this.shadowRoot)
    }

    connectedCallback() {
        this.#sync()
    }

    attributeChangedCallback() {
        this.#sync()
    }

    #sync() {
        if (!this.$button) return
        this.$button.disabled = this.hasAttribute("disabled")
        const name = this.dataset.icon
        let lead = this.shadowRoot.querySelector("nx-icon[data-lead]")
        if (name) {
            if (!lead) {
                lead = document.createElement("nx-icon")
                lead.setAttribute("data-lead", "")
                this.$button.prepend(lead)
            }
            lead.setAttribute("name", name)
        } else lead?.remove()
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-button")) customElements.define("nx-button", NxButton)

export default NxButton
