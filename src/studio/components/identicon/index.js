/**
 * <nx-identicon data-seed="…"> — the akao identicon, algorithm intact: a
 * deterministic, mirror-symmetric pixel grid derived from the seed's hash.
 * A public key becomes a face — the visual identity used everywhere an
 * identity appears (Users list, the signed-in chip). fill: currentColor.
 */

import { render } from "../../../core/UI.js"
import { identiconTemplate } from "./template.js"

export class NxIdenticon extends HTMLElement {
    static observedAttributes = ["data-seed", "data-size"]

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        render(identiconTemplate(this), this.shadowRoot)
    }

    attributeChangedCallback(name, last, value) {
        if (last !== value) this.paint()
    }

    connectedCallback() {
        this.paint()
    }

    /** The akao hash — deterministic 32-bit from the seed string. */
    #hash(str) {
        let hash = 0
        for (let i = 0; i < str.length; i++) {
            hash = (hash << 5) - hash + str.charCodeAt(i)
            hash = hash & hash
        }
        return Math.abs(hash)
    }

    paint() {
        const svg = this.$svg
        if (!svg) return
        while (svg.firstChild) svg.removeChild(svg.firstChild)
        const seed = this.dataset.seed
        if (!seed || ["null", "undefined"].includes(seed)) return

        const size = parseInt(this.dataset.size, 10) || 5
        const grid = size % 2 === 0 ? size + 1 : size
        svg.setAttribute("viewBox", `0 0 ${grid} ${grid}`)

        const hash = this.#hash(seed)
        const half = Math.floor(grid / 2)
        const matrix = []
        for (let row = 0; row < grid; row++) {
            const cells = []
            for (let col = 0; col <= half; col++) {
                const bit = (row * grid + col) % 32
                cells.push(((hash >> bit) & 1) === 1)
            }
            matrix.push(cells)
        }
        for (let row = 0; row < grid; row++)
            for (let col = 0; col < grid; col++) {
                const filled = col <= half ? matrix[row][col] : matrix[row][grid - col - 1]
                if (!filled) continue
                const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect")
                rect.setAttribute("x", col)
                rect.setAttribute("y", row)
                rect.setAttribute("width", 1)
                rect.setAttribute("height", 1)
                rect.setAttribute("fill", "currentColor")
                svg.appendChild(rect)
            }
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-identicon")) customElements.define("nx-identicon", NxIdenticon)

export default NxIdenticon
