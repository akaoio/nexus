/** <nx-modal> styles — a native <dialog> dressed in the design tokens. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    dialog {
        background: var(--surface); color: var(--text);
        
        box-shadow: var(--shadow); padding: 0; min-width: min(92vw, 22rem); max-width: min(94vw, 30rem);
    }
    dialog::backdrop { background: hsl(var(--h1, 216) 84% 5% / 0.45) }
    header {
        display: flex; gap: var(--sp-3, 0.75rem); align-items: center;
        padding: var(--sp-3, 0.75rem) var(--sp-4, 1rem); background: var(--surface-2);
        font-weight: 600;
    }
    header .spacer { flex: 1 }
    .close { display: inline-flex; cursor: pointer; color: var(--muted) }
    .close:hover { color: var(--text) }
    .body { padding: var(--sp-4, 1rem) }
    ::slotted(*) { max-width: 100% }
`

export default STYLE
