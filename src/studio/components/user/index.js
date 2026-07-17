/**
 * <nx-user> — the akao user chip for the Studio session: hidden until signed
 * in; then the identity's IDENTICON (the pubkey as a face) + shortened key.
 * Clicking asks to sign out through the modal (the akao signout flow).
 * The app wires NxUser.onSignout once.
 */

import { render } from "../../../core/UI.js"
import { userTemplate } from "./template.js"
import { confirmDialog } from "../../kit.js"

export class NxUser extends HTMLElement {
    static onSignout = null
    static observedAttributes = ["data-pub"]

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        render(userTemplate(this), this.shadowRoot)
    }

    attributeChangedCallback() {
        this.paint()
    }

    connectedCallback() {
        this.paint()
    }

    paint() {
        const pub = this.dataset.pub
        if (!this.$identicon) return
        if (pub) {
            this.$identicon.dataset.seed = pub
            this.$pub.textContent = pub.slice(0, 8) + "…"
        } else {
            this.$identicon.removeAttribute("data-seed")
            this.$pub.textContent = ""
        }
    }

    async askSignout() {
        if (await confirmDialog("Sign out of this session?")) NxUser.onSignout?.()
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-user")) customElements.define("nx-user", NxUser)

export default NxUser
