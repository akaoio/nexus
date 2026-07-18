/**
 * <nx-svg data-src="…"> — the akao ui-svg primitive: fetch an SVG FILE and
 * render it INLINE (shadow DOM), because only inline SVG can inherit CSS —
 * an <img src> can never take `fill: currentColor`. The file stays the
 * single source of truth (redraw it, reload, done); every fill is forced
 * onto currentColor on the way in, so the HOST's color (e.g. the accent)
 * paints the mark — live across theme and accent switches.
 */

import { STYLE } from "./styles.css.js"

/** Prolog/comments out, every fill onto currentColor (Inkscape-proof). */
const inlinable = (svg) => svg
    .replace(/<\?xml[\s\S]*?\?>/, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/fill\s*:\s*(?!none)[^;"'}]+/g, "fill:currentColor")
    .replace(/fill="(?!none|currentColor)[^"]*"/g, 'fill="currentColor"')

export class NxSvg extends HTMLElement {
    static observedAttributes = ["data-src"]

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        this.shadowRoot.append(STYLE())
    }

    attributeChangedCallback(name, last, value) {
        if (name !== "data-src" || last === value || !value) return
        fetch(value)
            .then((res) => (res.ok ? res.text() : Promise.reject(new Error(res.status))))
            .then((svg) => {
                this.shadowRoot.querySelector("svg")?.remove()
                const holder = document.createElement("div")
                holder.innerHTML = inlinable(svg)
                const mark = holder.querySelector("svg")
                if (mark) this.shadowRoot.append(mark)
            })
            .catch((error) => console.error("nx-svg:", value, error))
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-svg")) customElements.define("nx-svg", NxSvg)

export default NxSvg
