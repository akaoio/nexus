/**
 * <nx-modal data-header="key"> — the akao MODAL primitive: a shadow <dialog>
 * with a dictionary-bound header (<nx-context>), a close control, and the body
 * slotted. show()/showModal()/close() exactly like the original; clicking
 * the backdrop closes.
 */

import { render } from "../../../kernel/UI.js"
import { modalTemplate } from "./template.js"

export class NxModal extends HTMLElement {
    static observedAttributes = ["data-header"]

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        render(modalTemplate(this), this.shadowRoot)
    }

    connectedCallback() {
        this.#sync()
        this.dialog.addEventListener("click", (e) => {
            if (e.target === this.dialog) this.close() // backdrop
        })
        this.dialog.addEventListener("close", () => this.dispatchEvent(new CustomEvent("close")))
    }

    attributeChangedCallback() {
        this.#sync()
    }

    #sync() {
        if (this.$header && this.dataset.header) this.$header.dataset.key = this.dataset.header
    }

    show() {
        this.dialog.show()
    }

    showModal() {
        this.dialog.showModal()
    }

    close() {
        this.dialog.close()
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-modal")) customElements.define("nx-modal", NxModal)

export default NxModal
