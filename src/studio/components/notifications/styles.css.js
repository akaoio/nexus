/** <nx-notifications> styles — the toast stack, token-dressed. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host {
        position: fixed; bottom: var(--sp-4, 1rem); right: var(--sp-4, 1rem); z-index: 90;
        display: flex; flex-direction: column; gap: var(--sp-2, 0.5rem); max-width: min(92vw, 23.75rem);
    }
    .note {
        background: var(--surface); box-shadow: inset 0.1875rem 0 0 var(--accent);
        box-shadow: var(--shadow); padding: var(--sp-2, 0.5rem) var(--sp-3, 0.875rem);
        font-size: var(--text-md, 0.875rem); transition: opacity var(--ease, 160ms);
    }
    .note.ok { box-shadow: inset 0.1875rem 0 0 var(--ok) }
    .note.err { box-shadow: inset 0.1875rem 0 0 var(--danger) }
`

export default STYLE
