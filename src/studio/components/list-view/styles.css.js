/** <nx-list-view> styles — data table in the workbench voice. */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 14px); display: block }
    .bar { display: flex; gap: 8px; align-items: center; margin: 6px 0 }
    select, button {
        font: inherit; padding: 3px 8px; border: 1px solid var(--border, #94a3b8);
        border-radius: var(--radius-sm, 4px); background: var(--surface, transparent); color: inherit; cursor: pointer;
    }
    button:hover { border-color: var(--accent, #64748b) }
    table { border-collapse: collapse; width: 100% }
    th, td {
        border-bottom: 1px solid var(--border, #94a3b833); padding: 6px 10px; text-align: left;
        max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    }
    th {
        background: var(--surface-2, #8881); cursor: pointer; user-select: none;
        font-size: var(--text-xs, 12px); text-transform: uppercase; letter-spacing: .06em; color: var(--muted, inherit);
    }
    th:hover { color: var(--text, inherit) }
    tr.group-head td { background: var(--surface-2, #8882); font-weight: 600 }
    .muted { color: var(--muted, #64748b) }
`

export default STYLE
