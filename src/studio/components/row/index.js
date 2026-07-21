/**
 * <nx-row> — a list row as a COMPONENT (ARCHITECTURE.md §7.1: widgets are
 * `nx-*`, modules compose them).
 *
 * Three routes hand-built this same shape — users, jobs and permissions — in
 * about a dozen createElement calls apiece, none of which the others could
 * reuse: a `.nx-row` holding an optional leading element, a `.nx-who` block of
 * a label over a `.nx-pub` detail line, and trailing controls.
 *
 *   const row = document.createElement("nx-row")
 *   row.dataset.label = user.name
 *   row.dataset.detail = user.pub
 *   row.lead = identicon          // optional
 *   row.tail = [chip, editButton] // optional
 *
 * LIGHT DOM, like nx-navlink and for the same reason: the row's appearance is
 * page-level CSS (.nx-row/.nx-who/.nx-pub), and a shadow root would cut it off
 * from the stylesheet that gives it its shape.
 *
 * `lead` and `tail` are properties rather than slots because light DOM has no
 * slots and paint() owns the children — passing them as markup would mean
 * paint() destroying what the caller just appended.
 */

import { detailLine } from "./detail.js"

// The same guard the kernel's Component base uses. A component whose module a
// NODE clause imports must not explode at load time — `extends HTMLElement`
// throws before any `{ browser: true }` skip can apply, taking the whole run
// with it. nx-navlink and nx-identicon get away without this only because no
// node-registered test imports them.
const BaseElement = typeof HTMLElement !== "undefined" ? HTMLElement : class {}

export class NxRow extends BaseElement {
    static observedAttributes = ["data-label", "data-detail"]

    #lead = null
    #tail = []

    connectedCallback() {
        this.paint()
    }

    attributeChangedCallback() {
        if (this.isConnected) this.paint()
    }

    /** The element before the label — an identicon, an icon, a status dot. */
    set lead(node) {
        this.#lead = node ?? null
        if (this.isConnected) this.paint()
    }

    get lead() {
        return this.#lead
    }

    /** Controls after the label — chips, buttons. One node or several. */
    set tail(nodes) {
        this.#tail = (Array.isArray(nodes) ? nodes : [nodes]).filter(Boolean)
        if (this.isConnected) this.paint()
    }

    get tail() {
        return this.#tail
    }

    /** Compose a detail line from optional parts, dropping the absent ones. */
    static detail(parts, separator) {
        return detailLine(parts, separator)
    }

    paint() {
        this.className = "nx-row"

        const who = document.createElement("div")
        who.className = "nx-who"

        const label = document.createElement("div")
        label.textContent = this.dataset.label ?? ""
        who.append(label)

        // An absent detail leaves no empty line behind — a row with nothing to
        // say underneath should not reserve space for it.
        const detail = this.dataset.detail ?? ""
        if (detail) {
            const sub = document.createElement("div")
            sub.className = "nx-pub"
            sub.textContent = detail
            who.append(sub)
        }

        this.replaceChildren(...[this.#lead, who, ...this.#tail].filter(Boolean))
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-row")) customElements.define("nx-row", NxRow)

export default NxRow
