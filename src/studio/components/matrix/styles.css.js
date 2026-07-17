/** <nx-matrix> styles — the policy verdict table, token-dressed. */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host { display: block }
    h3 {
        margin: 0 0 0.625rem; font-size: var(--text-xs); text-transform: uppercase;
        letter-spacing: .07em; color: var(--muted); font-weight: 600;
    }
    .scroll { overflow-x: auto; max-width: 100% }
    table { border-collapse: collapse; width: 100%; font-size: var(--text-md) }
    th, td {
        border-bottom: var(--border-width, 1px) solid var(--border); padding: 0.5rem 0.625rem;
        text-align: left; white-space: nowrap;
    }
    th {
        background: var(--surface-2); font-size: var(--text-xs); text-transform: uppercase;
        letter-spacing: .06em; color: var(--muted);
    }
    td.mono { font-family: var(--mono); font-size: var(--text-sm) }
    td.num { text-align: right; font-family: var(--mono); font-size: var(--text-sm) }
    .chip {
        font-family: var(--mono); font-size: var(--text-xs); padding: 0.1875rem 0.5625rem;
        border-radius: 62.4375rem; border: var(--border-width, 1px) solid var(--border);
        color: var(--muted); margin-right: 0.25rem; display: inline-block;
    }
    .chip.accent { color: var(--accent); border-color: color-mix(in hsl, var(--accent) 45%, var(--border)) }
    .note { color: var(--muted); font-size: var(--text-sm); margin: 0.5rem 0 0 }
    .empty { color: var(--muted) }
`

export default STYLE
