/** <nx-icon> template — one svg shell; the body swaps by name. */

import { html } from "../../../kernel/UI.js"
import { STYLE } from "./styles.css.js"

export const iconTemplate = (c) => html`
    ${STYLE()}
    <svg viewBox="0 0 16 16" aria-hidden="true" ${({ element }) => (c.$svg = element)}></svg>
`

export default { iconTemplate }
