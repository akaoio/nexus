/** <nx-button> styles — square, borderless (tint speaks instead), fixed
 *  control height; the icon variant is a FIXED square so an active state can
 *  never change its size. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host { display: inline-flex }
    :host([hidden]) { display: none }
    button {
        font: inherit; color: inherit; cursor: pointer;
        border: none; background: var(--surface-2, transparent);
        padding: 0 0.75rem; height: var(--control-h, 2.25rem); width: 100%;
        display: inline-flex; gap: 0.375rem; align-items: center; justify-content: center;
        transition: background var(--ease, 160ms), color var(--ease, 160ms);
    }
    button:hover { background: var(--accent-soft, rgba(0,0,0,.06)) }
    button:disabled { opacity: .55; cursor: default }
    :host([data-variant="primary"]) button { background: var(--accent); color: var(--accent-fg); font-weight: 600 }
    :host([data-variant="primary"]) button:hover { filter: brightness(1.06) }
    :host([data-variant="danger"]) button { color: var(--danger); background: color-mix(in srgb, var(--danger) 10%, transparent) }
    :host([data-variant="icon"]) button { padding: 0; width: var(--control-h, 2.25rem); flex: none }
    :host([data-variant="option"]) button { justify-content: flex-start; gap: 0.5rem }
    /* the ON state changes COLOR only — geometry is untouchable (fixed size) */
    :host([data-on]) button { background: var(--accent-soft); color: var(--accent); font-weight: 600 }
    :focus-visible { outline: 0.125rem solid var(--accent); outline-offset: 1px }
`

export default STYLE
