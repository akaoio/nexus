/**
 * <nx-navlink> — a sidebar entry as a COMPONENT (no hand-built DOM in the
 * shell): composes the nx-a primitive (localized href, pushState, pre-cache),
 * an nx-icon in a FIXED square cell (the cell never moves between nav
 * levels — the rail collapses around it), and a label that is either a
 * dictionary key (<nx-context>) or plain text (an entity name).
 *
 *   <nx-navlink data-to="/entities" data-icon="plus-lg" data-key="entities">
 *   <nx-navlink data-to="/entity/task" data-icon="database" data-label="task" data-active>
 *   <nx-navlink data-to="/settings/ai" data-icon="stars" data-key="ai" data-sub>
 */

import "../a/index.js"
import "../icon/index.js"
import "../context/index.js"

export class NxNavlink extends HTMLElement {
    static observedAttributes = ["data-to", "data-icon", "data-key", "data-label", "data-active", "data-sub"]

    connectedCallback() {
        this.paint()
    }

    attributeChangedCallback() {
        if (this.isConnected) this.paint()
    }

    paint() {
        const a = document.createElement("a", { is: "nx-a" })
        a.setAttribute("is", "nx-a") // serialize for clarity; define() already upgraded it
        a.dataset.to = this.dataset.to ?? "/"
        a.className = (this.hasAttribute("data-active") ? "active" : "") + (this.hasAttribute("data-sub") ? " sub" : "")

        const ico = document.createElement("span")
        ico.className = "ico"
        const icon = document.createElement("nx-icon")
        icon.setAttribute("name", this.dataset.icon ?? "database")
        ico.append(icon)

        const lbl = document.createElement("span")
        lbl.className = "lbl"
        if (this.dataset.key) {
            const text = document.createElement("nx-context")
            text.dataset.key = this.dataset.key
            if (this.dataset.label != null) text.dataset.fallback = this.dataset.label
            lbl.append(text)
        } else lbl.append(this.dataset.label ?? "")

        a.append(ico, lbl)
        this.replaceChildren(a)
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-navlink")) customElements.define("nx-navlink", NxNavlink)

export default NxNavlink
