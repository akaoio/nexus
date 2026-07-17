/** <nx-button> template — one shadow button, content slotted (akao shape). */

import { html } from "../../../kernel/UI.js"
import { STYLE } from "./styles.css.js"
import "../icon/index.js"

export const buttonTemplate = (c) => html`
    ${STYLE()}
    <button type="button" ${({ element }) => (c.$button = element)}>
        <slot></slot>
    </button>
`

export default { buttonTemplate }
