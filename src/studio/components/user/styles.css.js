/** <nx-user> styles — the akao user chip lesson: a QUIET icon-sized square
 *  (no border box, no raw pubkey text), the identicon IS the face; the menu
 *  is a small tinted sheet that closes itself (outside press, Escape, action). */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host { position: relative; display: inline-flex }
    :host(:not([data-pub])) { display: none }
    button.chip {
        font: inherit; color: inherit; cursor: pointer; border: none;
        background: transparent; padding: 0;
        width: var(--control-h, 2.25rem); height: var(--control-h, 2.25rem);
        display: inline-flex; align-items: center; justify-content: center;
        transition: background var(--ease, 160ms);
    }
    button.chip:hover, :host(.open) button.chip { background: var(--accent-soft, rgba(0,0,0,.08)) }
    nx-identicon { width: 1.375rem; height: 1.375rem; display: block }
    .menu {
        position: absolute; right: 0; top: calc(100% + 0.25rem); z-index: 95;
        background: var(--surface); box-shadow: var(--shadow); display: grid; min-width: 12rem; max-width: 18rem;
    }
    .menu[hidden] { display: none }
    .menu .who { padding: 0.5rem 0.75rem; background: var(--surface-2); font-size: var(--text-sm) }
    .menu .who code { font-family: var(--mono); font-size: var(--text-xs); color: var(--muted); display: block; overflow: hidden; text-overflow: ellipsis }
    .menu button {
        border: none; background: none; font: inherit; color: inherit;
        text-align: left; padding: 0.5rem 0.75rem; cursor: pointer;
    }
    .menu button:hover { background: var(--accent-soft); color: var(--accent) }
    .menu button.danger:hover { background: color-mix(in srgb, var(--danger) 12%, transparent); color: var(--danger) }
`

export default STYLE
