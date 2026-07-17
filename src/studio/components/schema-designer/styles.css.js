/** <nx-schema-designer> styles — verdict colors ride the semantic tokens. */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 14px); display: block }
    .panel { border-top: 2px solid var(--border, #94a3b8); margin-top: 10px; padding-top: 8px }
    .change { display: flex; gap: 8px; align-items: center; margin: 3px 0 }
    .badge { font-size: var(--text-xs, 12px); padding: 1px 8px; border-radius: 999px; color: #fff; font-family: var(--mono, inherit) }
    .badge.additive { background: var(--ok, #16a34a) }
    .badge.structural { background: var(--danger, #dc2626) }
    .verdict { font-weight: 600; margin: 6px 0 }
    .verdict.hot { color: var(--ok, #16a34a) }
    .verdict.migration { color: var(--danger, #dc2626) }
    .muted { color: var(--muted, #64748b) }
    select, code { font: inherit }
    select { padding: 3px 8px; border: 1px solid var(--border, #94a3b8); border-radius: var(--radius-sm, 4px); background: var(--surface, transparent); color: inherit }
    code { background: var(--surface-2, #8882); padding: .1em .4em; border-radius: 4px; font-family: var(--mono, ui-monospace, monospace); font-size: var(--text-sm, 12px) }
`

export default STYLE
