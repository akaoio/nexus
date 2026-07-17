/**
 * <nx-navigator> — the akao orbital navigator: an icon button whose children
 * open ON AN ORBIT around it; navigators nest inside navigators without
 * limit, each level expanding a wider ring (the layout derives itself from
 * --total/--i/--level/--active — see styles.css.js). Ported 1:1 from the
 * original mechanics, Bootstrap icons instead of svg files.
 */

import { render } from "../../../kernel/UI.js"
import { navigatorTemplate } from "./template.js"

export class NxNavigator extends HTMLElement {
    #cleanup = []

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        render(navigatorTemplate(this), this.shadowRoot)
    }

    connectedCallback() {
        if (this.dataset.icon) this.$icon.setAttribute("name", this.dataset.icon)

        // --active: how many levels are open along MY ancestor chain — the
        // outermost navigator carries it so every ring sizes consistently.
        const active = () => {
            let open = -1
            let el = this
            while (el instanceof NxNavigator) {
                if (el.$state.checked) open++
                if (!(el.parentElement instanceof NxNavigator)) break
                el = el.parentElement
            }
            el.style.setProperty("--active", open)
        }
        this.$state.addEventListener("change", active)
        this.#cleanup.push(() => this.$state.removeEventListener("change", active))

        // --total for me, --i for each orbiting child; async children (the
        // locales statics) recount via the slotchange event
        this.recount()
        this.$slot.addEventListener("slotchange", () => this.recount())
    }

    /** Re-derive --total/--i from the current slotted children. */
    recount() {
        const children = this.$slot.assignedElements()
        this.style.setProperty("--total", children.length)
        children.forEach((child, i) => child.style.setProperty("--i", i + 1))
    }

    disconnectedCallback() {
        this.#cleanup.forEach((off) => off())
    }

    /** Close this navigator (and any open descendants). */
    close() {
        for (const nav of [this, ...this.querySelectorAll("nx-navigator")]) {
            if (nav.$state?.checked) {
                nav.$state.checked = false
                nav.$state.dispatchEvent(new Event("change"))
            }
        }
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-navigator")) customElements.define("nx-navigator", NxNavigator)

export default NxNavigator
