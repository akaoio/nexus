/** <nx-icon> styles — icons size from the --icon token, color from text. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--icon, 1em);
        height: var(--icon, 1em);
        flex: none;
        vertical-align: -0.125em;
    }
    svg { width: 100%; height: 100%; fill: currentColor }
`

export default STYLE
