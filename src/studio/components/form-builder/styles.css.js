/** <nx-form-builder> / <nx-form> styles — token-driven. */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 14px); display: block }
    .head, .row { display: flex; gap: 6px; align-items: center; flex-wrap: wrap; margin: 4px 0 }
    .row { border: 1px solid var(--border, #94a3b833); border-radius: var(--radius-sm, 6px); padding: 6px; background: var(--surface, transparent) }
    input, select, button {
        font: inherit; padding: 3px 8px; border: 1px solid var(--border, #94a3b8);
        border-radius: var(--radius-sm, 4px); background: var(--surface, transparent); color: inherit;
    }
    input.name { width: 9em; font-family: var(--mono, inherit); font-size: var(--text-sm, 13px) }
    input.label { width: 9em } input.extra { width: 9em }
    button { cursor: pointer }
    button:hover { border-color: var(--accent, #64748b) }
    button.remove { border-color: var(--danger, #dc2626); color: var(--danger, #dc2626) }
    .muted { color: var(--muted, #64748b) }
    .invalid { outline: 2px solid var(--danger, #dc2626) }
    .required-mark { color: var(--danger, #dc2626) }
    form .field { display: flex; gap: 8px; align-items: center; margin: 6px 0 }
    form label { min-width: 10em }
    .preview { border-top: 1px dashed var(--border, #94a3b8); margin-top: 10px; padding-top: 8px }
    :focus-visible { outline: 2px solid var(--accent, #0ea5e9); outline-offset: 1px }
`

export default STYLE
