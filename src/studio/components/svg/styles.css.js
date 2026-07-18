/** <nx-svg> styles — the akao ui-svg shape: the host is the box, the mark
 *  fills it; color (and therefore fill) inherits from the host's context. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        overflow: hidden;
        width: var(--icon, 1rem);
        height: var(--icon, 1rem);
    }
    svg { width: 100%; height: 100%; display: block; fill: currentColor }
`

export default STYLE
