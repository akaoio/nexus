/** <nx-schema-designer> styles — verdict colors ride the semantic tokens. */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 0.875rem); display: block }
    .panel { border-top: 0.125rem solid var(--border, #94a3b8); margin-top: 0.625rem; padding-top: 0.5rem }
    .change { display: flex; gap: 0.5rem; align-items: center; margin: 0.1875rem 0 }
    .badge { font-size: var(--text-xs, 0.75rem); padding: 1px 0.5rem; border-radius: 62.4375rem; color: #fff; font-family: var(--mono, inherit) }
    .badge.additive { background: var(--ok, #16a34a) }
    .badge.structural { background: var(--danger, #dc2626) }
    .verdict { font-weight: 600; margin: 0.375rem 0 }
    .verdict.hot { color: var(--ok, #16a34a) }
    .verdict.migration { color: var(--danger, #dc2626) }
    .muted { color: var(--muted, #64748b) }
    select, code { font: inherit }
    select { padding: 0.1875rem 0.5rem; border: 1px solid var(--border, #94a3b8); border-radius: var(--radius-sm, 0.25rem); background: var(--surface, transparent); color: inherit }
    code { background: var(--surface-2, #8882); padding: .1em .4em; border-radius: 0.25rem; font-family: var(--mono, ui-monospace, monospace); font-size: var(--text-sm, 0.75rem) }
`

export default STYLE
