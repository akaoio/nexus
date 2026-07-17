/** <nx-user> template — identicon + shortened pub; click asks to sign out. */

import { html } from "../../../core/UI.js"
import { STYLE } from "./styles.css.js"
import "../identicon/index.js"

export const userTemplate = (c) => html`
    ${STYLE()}
    <button type="button" title="Signed in — click to sign out"
        ${({ element }) => element.addEventListener("click", () => c.askSignout())}>
        <nx-identicon ${({ element }) => (c.$identicon = element)}></nx-identicon>
        <code ${({ element }) => (c.$pub = element)}></code>
    </button>
`

export default { userTemplate }
