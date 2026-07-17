/** <nx-query-builder> styles — token-driven; nesting depth reads as indent. */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 14px); display: block }
    .group {
        border-left: 3px solid var(--border, #94a3b8); border-radius: 2px;
        padding: 6px 0 6px 10px; margin: 6px 0; background: var(--surface-2, rgba(148, 163, 184, 0.06));
    }
    .group.negated { border-left-color: var(--danger, #dc2626) }
    .bar, .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 4px 0 }
    select, input, button {
        font: inherit; padding: 3px 8px; border: 1px solid var(--border, #94a3b8);
        border-radius: var(--radius-sm, 4px); background: var(--surface, transparent); color: inherit;
    }
    input { font-family: var(--mono, inherit); font-size: var(--text-sm, 13px) }
    button { cursor: pointer }
    button:hover { border-color: var(--accent, #64748b) }
    button.remove { border-color: var(--danger, #dc2626); color: var(--danger, #dc2626) }
    label.negate { display: inline-flex; gap: 4px; align-items: center; cursor: pointer }
    .empty { color: var(--muted, #64748b); font-style: italic; margin-right: 6px }
    :focus-visible { outline: 2px solid var(--accent, #0ea5e9); outline-offset: 1px }
`

export default STYLE
