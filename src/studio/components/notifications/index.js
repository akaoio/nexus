/**
 * <nx-notifications> — the akao NOTIFICATIONS primitive as the ONE toast
 * host: push(message, type) appends a note that fades and removes itself.
 * A single lazy instance serves the whole app (design once, use forever).
 */

import { render } from "../../../kernel/UI.js"
import { notificationsTemplate } from "./template.js"

export class NxNotifications extends HTMLElement {
    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        render(notificationsTemplate(this), this.shadowRoot)
    }

    /** The app-wide instance, mounted on first use. */
    static get instance() {
        let host = document.querySelector("nx-notifications")
        if (!host) {
            host = document.createElement("nx-notifications")
            document.body.append(host)
        }
        return host
    }

    push(message, type = "ok") {
        const note = document.createElement("div")
        note.className = "note " + type
        note.textContent = message
        this.$stack.append(note)
        setTimeout(() => {
            note.style.opacity = "0"
            setTimeout(() => note.remove(), 220)
        }, 3400)
        return note
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-notifications")) customElements.define("nx-notifications", NxNotifications)

export default NxNotifications
