/** <nx-identicon> styles — a square pixel identity, colored by context. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host { display: inline-flex; width: var(--icon-lg, 2.75rem); aspect-ratio: 1 / 1 }
    svg { width: 100%; height: 100%; shape-rendering: crispEdges}
`

export default STYLE
