/** <nx-search> styles — one big query box, results as tinted rows; scores
 *  speak mono and sit at the right edge, out of the reading line. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 0.875rem); display: block }
    input.query {
        font: inherit; font-size: var(--text-lg, 1rem);
        padding: 0.75rem 0.875rem; border: none;
        background: var(--surface-2, #8882); color: inherit; width: 100%;
    }
    input.query:focus { outline: 0.125rem solid var(--accent, currentColor); outline-offset: 0 }
    input.query::placeholder { color: var(--muted, #64748b) }
    .entity-head {
        display: inline-block; font-weight: 600; font-family: var(--mono, inherit);
        color: var(--accent, currentColor); background: var(--accent-soft, transparent);
        padding: 0.1875rem 0.5625rem; margin: 0.875rem 0 0.375rem; font-size: var(--text-sm, 0.8125rem);
    }
    .hit {
        display: flex; gap: 0.75rem; align-items: baseline;
        padding: 0.5rem 0.625rem; margin: 0.125rem 0;
    }
    .hit:hover { background: var(--surface-2, #8882) }
    .hit .label { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
    .score { color: var(--muted, #64748b); font-family: var(--mono, inherit); font-variant-numeric: tabular-nums; font-size: var(--text-xs, 0.75rem) }
    .muted { color: var(--muted, #64748b); padding: 0.875rem 0 0.25rem }
`

export default STYLE
