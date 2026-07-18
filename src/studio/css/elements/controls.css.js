/**
 * Shared control styles — buttons, inputs, fields (akao css/elements pattern).
 * Raw strings: the page stylesheet concatenates them; shadow components wrap
 * them with the kernel css\`\` tag. Tokens arrive via inherited custom props.
 */

export const controls = /* css */ `
button, select, input, textarea { font: inherit; color: inherit }
[hidden] { display: none !important }
button { cursor: pointer }
:focus-visible { outline: 0.125rem solid var(--accent); outline-offset: 1px}

.nx-btn {
    border: none; background: var(--surface-2);
    padding: 0 0.75rem; min-height: var(--control-h); display: inline-flex; gap: 0.375rem; align-items: center; justify-content: center;
    transition: border-color var(--ease), background var(--ease);
}
.nx-btn:hover { border-color: var(--accent) }
.nx-btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); font-weight: 600 }
.nx-btn.primary:hover { filter: brightness(1.06) }
.nx-btn.danger { color: var(--danger); border-color: var(--danger) }
.nx-btn.icon { padding: 0; width: var(--control-h) }
.nx-btn[disabled] { opacity: .55; cursor: default }

.nx-input {
    border: none; background: var(--surface-2);
    padding: 0 0.625rem; min-height: var(--control-h); width: 100%; transition: border-color var(--ease);
}
.nx-input:focus { border-color: var(--accent); outline: none }

.nx-label { color: var(--muted); font-size: var(--text-sm) }
.nx-field { display: flex; flex-direction: column; gap: var(--sp-1) }
.nx-form { display: grid; gap: var(--sp-3); align-content: start }
.nx-fields-row { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: var(--sp-2); align-items: end }
.nx-actions { display: flex; gap: var(--sp-2); margin-top: var(--sp-2) }
.nx-toolbar { display: flex; gap: var(--sp-2); align-items: center; flex-wrap: wrap }
.nx-check { display: inline-flex; gap: var(--sp-2); align-items: center; accent-color: var(--accent) }
input[type="checkbox"] { accent-color: var(--accent) }
`

export default controls
