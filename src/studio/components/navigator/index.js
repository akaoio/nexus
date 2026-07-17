/**
 * <nx-navigator> — the akao orbital navigator: an icon toggle whose children
 * open ON AN ORBIT around it; navigators nest inside navigators without limit,
 * each deeper level widening the ring. Faithful to the original interaction —
 * open rises to the screen center, a sub-orbit recenters over its parent — but
 * the geometry is driven in JS (deterministic), not through the fragile
 * ::slotted custom-property cascade, and clicks are ROUTED to the nearest
 * toggle so a center click never toggles the wrong (stacked) navigator.
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
        else this.$icon.removeAttribute("name")

        // Only the ROOT installs the router: on pointerdown anywhere in the
        // orbit it toggles the navigator whose TOGGLE is nearest the click
        // (within that toggle's radius) — no cross-shadow z-index guesswork.
        if (!(this.parentElement instanceof NxNavigator)) {
            const onDown = (event) => this.#route(event)
            this.addEventListener("click", onDown)
            this.#cleanup.push(() => this.removeEventListener("click", onDown))
        }

        this.#recount()
        this.$slot.addEventListener("slotchange", () => {
            this.#recount()
            this.#rootNav().#layout()
        })
        this.#rootNav().#layout()
    }

    disconnectedCallback() {
        this.#cleanup.forEach((off) => off())
    }

    /** The outermost navigator of this system. */
    #rootNav() {
        let el = this
        while (el.parentElement instanceof NxNavigator) el = el.parentElement
        return el
    }

    /** Every navigator in this subtree, self first. */
    #tree() {
        return [this, ...this.querySelectorAll("nx-navigator, nx-locales, nx-themes")].filter((el) => el instanceof NxNavigator)
    }

    /** --total for me, --i for each orbiting child. */
    #recount() {
        const children = this.$slot.assignedElements()
        this.style.setProperty("--total", children.length)
        children.forEach((child, i) => child.style.setProperty("--i", i + 1))
    }

    /** Route a pointerdown to the nearest toggle within its radius. */
    #route(event) {
        let best = null
        let bestDist = Infinity
        for (const nav of this.#tree()) {
            const r = nav.$toggle.getBoundingClientRect()
            const cx = r.x + r.width / 2
            const cy = r.y + r.height / 2
            const dist = Math.hypot(event.clientX - cx, event.clientY - cy)
            if (dist <= r.width / 2 && dist < bestDist) {
                best = nav
                bestDist = dist
            }
        }
        if (!best) return // clicks on planets (language buttons) fall through
        event.preventDefault()
        event.stopPropagation()
        best.toggle()
    }

    /** Flip open/closed (closing cascades to descendants), then re-layout. */
    toggle() {
        this.$state.checked = !this.$state.checked
        if (!this.$state.checked)
            for (const nav of this.#tree()) if (nav !== this && nav.$state) nav.$state.checked = false
        this.#rootNav().#layout()
    }

    /** Close this navigator and any open descendants. */
    close() {
        if (this.$state.checked) this.toggle()
    }

    /** --active = deepest open depth, set on the outermost navigator. */
    #syncActive() {
        const root = this.#rootNav()
        let deepest = -1
        for (const nav of root.#tree()) {
            if (!nav.$state.checked) continue
            let depth = 0
            for (let p = nav.parentElement; p instanceof NxNavigator; p = p.parentElement) depth++
            deepest = Math.max(deepest, depth)
        }
        root.style.setProperty("--active", deepest)
    }

    /**
     * Position the WHOLE system by geometry. Every OPEN navigator collapses to
     * the system center; a CLOSED child of an open navigator sits on that
     * navigator's ring. Offsets are absolute from the root's box, applied as
     * inline transforms; opacity/pointer-events follow open state. Recursive.
     */
    #layout() {
        this.#syncActive()
        const root = this.#rootNav()
        const deepest = Number(root.style.getPropertyValue("--active")) || 0
        const size = parseFloat(getComputedStyle(root).getPropertyValue("--size")) || 44
        const step = size * 1.5

        const place = (nav, level, cx, cy) => {
            const parentOpen = nav.$state.checked
            const radius = step * (deepest - level + 1)
            nav.style.setProperty("--rad", radius + "px") // the visible orbit ring
            const kids = nav.$slot.assignedElements()
            kids.forEach((kid, i) => {
                const deg = (2 * Math.PI / kids.length) * i
                const kidOpen = kid instanceof NxNavigator && kid.$state.checked
                const kx = parentOpen && !kidOpen ? cx + Math.sin(deg) * radius : cx
                const ky = parentOpen && !kidOpen ? cy - Math.cos(deg) * radius : cy
                kid.style.transform = `translate(${kx}px, ${ky}px)`
                kid.style.opacity = parentOpen ? "1" : "0"
                kid.style.pointerEvents = parentOpen ? "auto" : "none"
                if (kid instanceof NxNavigator) place(kid, level + 1, kx, ky)
            })
        }
        place(root, 0, 0, 0)

        // the whole system RISES to the vertical screen center when open, so
        // rings never clip the bottom edge (akao's --center lift). The root
        // host carries it; its children ride along (their offsets are relative).
        const anyOpen = root.$state.checked
        const rise = Math.round(window.innerHeight / 2 - root.getBoundingClientRect().height)
        root.style.transform = anyOpen ? `translateY(-${rise}px)` : ""
        root.style.transition = "transform var(--speed, 160ms) cubic-bezier(.2,.7,.3,1.4)"
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-navigator")) customElements.define("nx-navigator", NxNavigator)

export default NxNavigator
