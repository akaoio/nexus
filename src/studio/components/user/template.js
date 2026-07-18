/** <nx-user> template — identicon chip; the menu carries the identity line
 *  (full pub, ellipsized) + profile + sign out. */

import { html } from "../../../core/UI.js"
import { STYLE } from "./styles.css.js"
import "../identicon/index.js"

export const userTemplate = (c) => html`
    ${STYLE()}
    <button type="button" class="chip" title="Session menu"
        ${({ element }) => element.addEventListener("click", (e) => { e.stopPropagation(); c.toggleMenu() })}>
        <nx-identicon ${({ element }) => (c.$identicon = element)}></nx-identicon>
    </button>
    <div class="menu" hidden ${({ element }) => (c.$menu = element)}>
        <div class="who">Signed in<code ${({ element }) => (c.$pub = element)}></code></div>
        <button type="button" ${({ element }) => element.addEventListener("click", () => c.goProfile())}>Profile</button>
        <button type="button" class="danger" ${({ element }) => element.addEventListener("click", () => c.askSignout())}>Sign out</button>
    </div>
`

export default { userTemplate }
