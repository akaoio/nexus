/** <nx-form-builder> / <nx-form> styles — token-driven. */

import { css } from "../../../core/UI/css.js"

export const STYLE = () => css`
    :host { font-family: var(--font, system-ui); font-size: var(--text-md, 0.875rem); display: block }
    .head, .row { display: flex; gap: 0.375rem; align-items: center; flex-wrap: wrap; margin: 0.25rem 0 }
    .row { border: 1px solid var(--border, #94a3b833); border-radius: var(--radius-sm, 0.375rem); padding: 0.375rem; background: var(--surface, transparent) }
    input, select, button {
        font: inherit; padding: 0.1875rem 0.5rem; border: 1px solid var(--border, #94a3b8);
        border-radius: var(--radius-sm, 0.25rem); background: var(--surface, transparent); color: inherit;
    }
    input.name { width: 9em; font-family: var(--mono, inherit); font-size: var(--text-sm, 0.8125rem) }
    input.label { width: 9em } input.extra { width: 9em }
    button { cursor: pointer }
    button:hover { border-color: var(--accent, #64748b) }
    button.remove { border-color: var(--danger, #dc2626); color: var(--danger, #dc2626) }
    .muted { color: var(--muted, #64748b) }
    .invalid { outline: 0.125rem solid var(--danger, #dc2626) }
    .required-mark { color: var(--danger, #dc2626) }
    form .field { display: flex; gap: 0.5rem; align-items: center; margin: 0.375rem 0 }
    form label { min-width: 10em }
    .preview { border-top: 1px dashed var(--border, #94a3b8); margin-top: 0.625rem; padding-top: 0.5rem }
    :focus-visible { outline: 0.125rem solid var(--accent, #0ea5e9); outline-offset: 1px }
`

export default STYLE
