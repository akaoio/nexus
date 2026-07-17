/** <nx-search> styles — scores speak mono; entity heads carry the accent. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 0.875rem); display: block }
    input.query {
        font: inherit; padding: 0.5rem 0.625rem; border: 1px solid var(--border, #94a3b8);
        border-radius: var(--radius-sm, 0.375rem); background: var(--surface, transparent); color: inherit; width: 100%;
    }
    input.query:focus { border-color: var(--accent, #0ea5e9); outline: none }
    .entity-head { font-weight: 600; margin: 0.625rem 0 0.125rem; color: var(--accent, #0ea5e9) }
    .hit { display: flex; gap: 0.5rem; margin: 0.1875rem 0; align-items: baseline }
    .score { color: var(--muted, #64748b); font-family: var(--mono, inherit); font-variant-numeric: tabular-nums; min-width: 4em; font-size: var(--text-sm, 0.8125rem) }
    .muted { color: var(--muted, #64748b); font-style: italic }
`

export default STYLE
