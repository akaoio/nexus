/** <nx-list-view> styles — data table in the workbench voice. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 0.875rem); display: block }
    .bar { display: flex; gap: 0.5rem; align-items: center; margin: 0.375rem 0 }
    select, button {
        font: inherit; padding: 0.1875rem 0.5rem; border: 1px solid var(--border, #94a3b8);
        border-radius: var(--radius-sm, 0.25rem); background: var(--surface, transparent); color: inherit; cursor: pointer;
    }
    button:hover { border-color: var(--accent, #64748b) }
    table { border-collapse: collapse; width: 100% }
    th, td {
        border-bottom: 1px solid var(--border, #94a3b833); padding: 0.375rem 0.625rem; text-align: left;
        max-width: 13.75rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    th {
        background: var(--surface-2, #8881); cursor: pointer; user-select: none;
        font-size: var(--text-xs, 0.75rem); text-transform: uppercase; letter-spacing: .06em; color: var(--muted, inherit);
    }
    th:hover { color: var(--text, inherit) }
    tr.group-head td { background: var(--surface-2, #8882); font-weight: 600 }
    .muted { color: var(--muted, #64748b) }
`

export default STYLE
