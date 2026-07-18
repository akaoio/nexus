/**
 * <nx-user> — the akao user chip for the Studio session: hidden until signed
 * in; then the identity's IDENTICON (the pubkey as a face) is the whole chip
 * — quiet, icon-sized, no border box. Its menu (identity line, profile,
 * sign out) closes ITSELF: outside press, Escape, or any action. The app
 * wires NxUser.onSignout / NxUser.onProfile once.
 */

import { render } from "../../../core/UI.js"
import { userTemplate } from "./template.js"
import { confirmDialog } from "../../kit/index.js"

export class NxUser extends HTMLElement {
    static onSignout = null
    static onProfile = null
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

    disconnectedCallback() {
        this.closeMenu()
    }

    paint() {
        const pub = this.dataset.pub
        if (!this.$identicon) return
        if (pub) {
            this.$identicon.dataset.seed = pub
            this.$pub.textContent = pub
        } else {
            this.$identicon.removeAttribute("data-seed")
            this.$pub.textContent = ""
        }
    }

    // the menu closes ITSELF: any press outside, or Escape — never lingers
    #outside = (e) => {
        if (!e.composedPath().includes(this)) this.closeMenu()
    }
    #escape = (e) => {
        if (e.key === "Escape") this.closeMenu()
    }

    closeMenu() {
        if (!this.$menu) return
        this.$menu.hidden = true
        this.classList.remove("open")
        document.removeEventListener("pointerdown", this.#outside, true)
        document.removeEventListener("keydown", this.#escape, true)
    }

    toggleMenu() {
        if (!this.$menu.hidden) return this.closeMenu()
        this.$menu.hidden = false
        this.classList.add("open")
        document.addEventListener("pointerdown", this.#outside, true)
        document.addEventListener("keydown", this.#escape, true)
    }

    goProfile() {
        this.closeMenu()
        NxUser.onProfile?.(this.dataset.pub)
    }

    async askSignout() {
        this.closeMenu()
        if (await confirmDialog("Sign out of this session?")) NxUser.onSignout?.()
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-user")) customElements.define("nx-user", NxUser)

export default NxUser
