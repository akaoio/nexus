/** <nx-search> styles — scores speak mono; entity heads carry the accent. */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 14px); display: block }
    input.query {
        font: inherit; padding: 8px 10px; border: 1px solid var(--border, #94a3b8);
        border-radius: var(--radius-sm, 6px); background: var(--surface, transparent); color: inherit; width: 100%;
    }
    input.query:focus { border-color: var(--accent, #0ea5e9); outline: none }
    .entity-head { font-weight: 600; margin: 10px 0 2px; color: var(--accent, #0ea5e9) }
    .hit { display: flex; gap: 8px; margin: 3px 0; align-items: baseline }
    .score { color: var(--muted, #64748b); font-family: var(--mono, inherit); font-variant-numeric: tabular-nums; min-width: 4em; font-size: var(--text-sm, 13px) }
    .muted { color: var(--muted, #64748b); font-style: italic }
`

export default STYLE
