/**
 * <nx-navigator> — the akao orbital navigator, ported VERBATIM from the
 * original (src/UI/components/navigator/index.js). Children open on an orbit
 * by pure CSS trigonometry; navigators nest without limit; the checkbox's
 * native label toggles it and its `change` recomputes --active (open depth)
 * up the ancestor chain. The ONLY changes from the source: the icon element
 * (ui-icon→nx-icon, data-icon→name) and the import paths.
 *
 * CRITICAL — every navigator (including <nx-locales>/<nx-themes>) must share
 * the SAME tag name, because the original active() walks the ancestor chain by
 * `el.tagName === parent.tagName`. So locales/themes are plain nx-navigator
 * elements populated by a controller (see app/navigators.js), not subclasses.
 */

import { render } from "../../../core/UI.js"
import { navigatorTemplate } from "./template.js"

export class NxNavigator extends HTMLElement {
    #subscriptions = []

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        render(navigatorTemplate(this), this.shadowRoot)
    }

    connectedCallback() {
        const state = this.$state
        const label = this.$toggle
        const icon = this.$icon

        const vibrate = () => {
            if ("vibrate" in navigator) navigator.vibrate(20)
        }
        // icon (ui-icon data-icon → nx-icon name)
        if (icon) {
            if (this.dataset.icon) icon.setAttribute("name", this.dataset.icon)
            else icon.removeAttribute("name")
        }

        label.addEventListener("click", vibrate)
        this.#subscriptions.push(() => label.removeEventListener("click", vibrate))

        const active = () => {
            let i = -1
            let el = this
            while (el.tagName === "NX-NAVIGATOR") {
                if (el.shadowRoot.querySelector("#state").checked) i++
                if (!el.parentElement || el.tagName !== el.parentElement.tagName) break
                el = el.parentElement
            }
            el.style.setProperty("--active", i)
        }
        state.addEventListener("change", active)
        this.#subscriptions.push(() => state.removeEventListener("change", active))

        // Count children in slot: --total for me, --i for each child
        this.#recount()
        this.$slot.addEventListener("slotchange", () => this.#recount())
    }

    #recount() {
        const children = this.$slot.assignedElements()
        this.style.setProperty("--total", children.length)
        children.forEach((child, i) => child.style.setProperty("--i", i + 1))
    }

    disconnectedCallback() {
        this.#subscriptions.forEach((off) => off())
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-navigator")) customElements.define("nx-navigator", NxNavigator)

export default NxNavigator
