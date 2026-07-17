/** <nx-matrix> template — heading + table shell; rows paint from .policies. */

import { html } from "../../../core/UI.js"
import { STYLE } from "./styles.css.js"

export const matrixTemplate = (c) => html`
    ${STYLE()}
    <h3>Role × Entity × Action</h3>
    <div ${({ element }) => (c.$body = element)}></div>
`

export default { matrixTemplate }
