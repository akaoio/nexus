/** <nx-user> template — identicon + shortened pub; click opens the session
 *  menu (profile / sign out — the akao signout flow behind a confirm). */

import { html } from "../../../core/UI.js"
import { STYLE } from "./styles.css.js"
import "../identicon/index.js"

export const userTemplate = (c) => html`
    ${STYLE()}
    <button type="button" class="chip" title="Signed in — session menu"
        ${({ element }) => element.addEventListener("click", () => c.toggleMenu())}>
        <nx-identicon ${({ element }) => (c.$identicon = element)}></nx-identicon>
        <code ${({ element }) => (c.$pub = element)}></code>
    </button>
    <div class="menu" hidden ${({ element }) => (c.$menu = element)}>
        <button type="button" ${({ element }) => element.addEventListener("click", () => c.goProfile())}>Profile</button>
        <button type="button" class="danger" ${({ element }) => element.addEventListener("click", () => c.askSignout())}>Sign out</button>
    </div>
`

export default { userTemplate }
