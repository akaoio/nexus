/** <nx-context> styles — a text node with no box of its own. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host { display: contents }
`

export default STYLE
