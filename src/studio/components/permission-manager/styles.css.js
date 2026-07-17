/** <nx-permission-manager> styles — a policy card per policy, accent spine. */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 14px); display: block }
    .policy {
        border: 1px solid var(--border, #94a3b833); border-left: 3px solid var(--accent, #0ea5e9);
        border-radius: var(--radius-sm, 6px); padding: 8px; margin: 8px 0; background: var(--surface, transparent);
    }
    .policy.invalid { border-left-color: var(--danger, #dc2626) }
    .line { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 4px 0 }
    select, input, button {
        font: inherit; padding: 3px 8px; border: 1px solid var(--border, #94a3b8);
        border-radius: var(--radius-sm, 4px); background: var(--surface, transparent); color: inherit;
    }
    button { cursor: pointer }
    button:hover { border-color: var(--accent, #64748b) }
    button.remove { border-color: var(--danger, #dc2626); color: var(--danger, #dc2626) }
    label.action, label.flag { display: inline-flex; gap: 3px; align-items: center; cursor: pointer }
    input.permlevel { width: 3.5em; font-family: var(--mono, inherit) } input.roles { width: 12em }
    input[type="checkbox"] { accent-color: var(--accent, #0ea5e9) }
    .rule-slot { margin-top: 6px }
    .muted { color: var(--muted, #64748b) }
`

export default STYLE
