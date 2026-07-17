/** <nx-button> styles — composes the shared control tokens (akao button). */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host { display: inline-flex }
    :host([hidden]) { display: none }
    button {
        font: inherit; color: inherit; cursor: pointer;
        border: var(--border-width, 1px) solid var(--border, currentColor);
        background: var(--surface, transparent); border-radius: var(--radius-sm, 0.375rem);
        padding: 0 0.75rem; min-height: var(--control-h, 2.25rem); width: 100%;
        display: inline-flex; gap: 0.375rem; align-items: center; justify-content: center;
        transition: border-color var(--ease, 160ms), background var(--ease, 160ms);
    }
    button:hover { border-color: var(--accent, currentColor) }
    button:disabled { opacity: .55; cursor: default }
    :host([data-variant="primary"]) button { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); font-weight: 600 }
    :host([data-variant="primary"]) button:hover { filter: brightness(1.06) }
    :host([data-variant="danger"]) button { color: var(--danger); border-color: var(--danger) }
    :host([data-variant="icon"]) button { padding: 0; width: var(--control-h, 2.25rem) }
    :focus-visible { outline: 0.125rem solid var(--accent); outline-offset: 1px }
`

export default STYLE
