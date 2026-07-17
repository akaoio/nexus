/** <nx-user> styles — the identity chip in the topbar. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host { display: none }
    :host([data-pub]) { display: inline-flex }
    button {
        font: inherit; cursor: pointer; background: var(--surface);
        border: var(--border-width, 1px) solid var(--border); border-radius: var(--radius-sm, 0.375rem);
        min-height: var(--control-h, 2.25rem); padding: 0 0.5rem;
        display: inline-flex; gap: 0.5rem; align-items: center; color: var(--accent);
    }
    button:hover { border-color: var(--accent) }
    nx-identicon { width: calc(var(--control-h, 2.25rem) - 0.75rem) }
    code { font-family: var(--mono); font-size: var(--text-xs); color: var(--muted) }
`

export default STYLE
