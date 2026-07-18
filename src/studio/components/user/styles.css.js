/** <nx-user> styles — the identity chip in the topbar. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host { display: none }
    :host([data-pub]) { display: inline-flex }
    button {
        font: inherit; cursor: pointer; background: var(--surface);
        background: var(--surface-2);
        min-height: var(--control-h, 2.25rem); padding: 0 0.5rem;
        display: inline-flex; gap: 0.5rem; align-items: center; color: var(--accent);
    }
    button:hover { border-color: var(--accent) }
    nx-identicon { width: calc(var(--control-h, 2.25rem) - 0.75rem) }
    code { font-family: var(--mono); font-size: var(--text-xs); color: var(--muted) }

    :host { position: relative }
    .menu {
        position: absolute; right: 0; top: calc(100% + 0.25rem); z-index: 95;
        background: var(--surface); box-shadow: var(--shadow); display: grid; min-width: 9rem;
    }
    .menu button { border: none; background: none; font: inherit; color: inherit; text-align: left; padding: 0.5rem 0.75rem; cursor: pointer }
    .menu button:hover { background: var(--accent-soft); color: var(--accent) }
    .menu button.danger:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger) }
`

export default STYLE
