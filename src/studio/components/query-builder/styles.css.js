/** <nx-query-builder> styles — token-driven; nesting depth reads as indent. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 0.875rem); display: block }
    .group {
        background: var(--surface-2, #8882); box-shadow: inset 0.1875rem 0 0 var(--border, #94a3b8);
        padding: 0.375rem 0 0.375rem 0.625rem; margin: 0.375rem 0; background: var(--surface-2, rgba(148, 163, 184, 0.06));
    }
    .group.negated { box-shadow: inset 0.1875rem 0 0 var(--danger, #dc2626) }
    .bar, .row { display: flex; gap: 0.375rem; align-items: center; flex-wrap: wrap; margin: 0.25rem 0 }
    select, input, button {
        font: inherit; padding: 0.1875rem 0.5rem; border: none; background: var(--surface-2, #8882); background: var(--surface, transparent); color: inherit;
    }
    input { font-family: var(--mono, inherit); font-size: var(--text-sm, 0.8125rem) }
    button { cursor: pointer }
    button:hover { border-color: var(--accent, #64748b) }
    button.remove { border-color: var(--danger, #dc2626); color: var(--danger, #dc2626) }
    label.negate { display: inline-flex; gap: 0.25rem; align-items: center; cursor: pointer }
    .empty { color: var(--muted, #64748b); font-style: italic; margin-right: 0.375rem }
    :focus-visible { outline: 0.125rem solid var(--accent, #0ea5e9); outline-offset: 1px }
`

export default STYLE
