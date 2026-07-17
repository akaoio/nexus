/**
 * <nx-themes> — the akao themes component AS AN ORBIT: a navigator planet
 * whose children are the three modes (auto / light / dark). Selecting calls
 * NxThemes.onSelect(mode).
 */

import { NxNavigator } from "../navigator/index.js"
import { icon } from "../../app/lib.js"

const MODES = [
    { mode: "auto", name: "circle-half" },
    { mode: "light", name: "sun" },
    { mode: "dark", name: "moon" }
]

export class NxThemes extends NxNavigator {
    static onSelect = null
    static current = "auto"

    constructor() {
        super()
        if (!this.dataset.icon) this.dataset.icon = "circle-half"
    }

    connectedCallback() {
        super.connectedCallback()
        this.paint()
    }

    paint() {
        this.replaceChildren(...MODES.map(({ mode, name }) => {
            const planet = document.createElement("button")
            planet.type = "button"
            planet.title = mode
            planet.className = mode === NxThemes.current ? "on" : ""
            planet.append(icon(name))
            planet.addEventListener("click", () => {
                NxThemes.current = mode
                NxThemes.onSelect?.(mode)
                this.paint()
            })
            return planet
        }))
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-themes")) customElements.define("nx-themes", NxThemes)

export default NxThemes
