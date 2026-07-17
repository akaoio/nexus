/** <nx-permission-manager> styles — a policy card per policy, accent spine. */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 0.875rem); display: block }
    .policy {
        border: 1px solid var(--border, #94a3b833); border-left: 0.1875rem solid var(--accent, #0ea5e9);
        border-radius: var(--radius-sm, 0.375rem); padding: 0.5rem; margin: 0.5rem 0; background: var(--surface, transparent);
    }
    .policy.invalid { border-left-color: var(--danger, #dc2626) }
    .line { display: flex; gap: 0.5rem; align-items: center; flex-wrap: wrap; margin: 0.25rem 0 }
    select, input, button {
        font: inherit; padding: 0.1875rem 0.5rem; border: 1px solid var(--border, #94a3b8);
        border-radius: var(--radius-sm, 0.25rem); background: var(--surface, transparent); color: inherit;
    }
    button { cursor: pointer }
    button:hover { border-color: var(--accent, #64748b) }
    button.remove { border-color: var(--danger, #dc2626); color: var(--danger, #dc2626) }
    label.action, label.flag { display: inline-flex; gap: 0.1875rem; align-items: center; cursor: pointer }
    input.permlevel { width: 3.5em; font-family: var(--mono, inherit) } input.roles { width: 12em }
    input[type="checkbox"] { accent-color: var(--accent, #0ea5e9) }
    .rule-slot { margin-top: 0.375rem }
    .muted { color: var(--muted, #64748b) }
`

export default STYLE
