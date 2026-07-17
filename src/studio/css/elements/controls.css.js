/**
 * Shared control styles — buttons, inputs, fields (akao css/elements pattern).
 * Raw strings: the page stylesheet concatenates them; shadow components wrap
 * them with the kernel css\`\` tag. Tokens arrive via inherited custom props.
 */

export const controls = /* css */ `
button, select, input, textarea { font: inherit; color: inherit }
button { cursor: pointer }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; border-radius: var(--radius-sm) }

.nx-btn {
    border: 1px solid var(--border); background: var(--surface); border-radius: var(--radius-sm);
    padding: 7px 12px; display: inline-flex; gap: 6px; align-items: center;
    transition: border-color var(--ease), background var(--ease);
}
.nx-btn:hover { border-color: var(--accent) }
.nx-btn.primary { background: var(--accent); color: var(--accent-fg); border-color: var(--accent); font-weight: 600 }
.nx-btn.primary:hover { filter: brightness(1.06) }
.nx-btn.danger { color: var(--danger); border-color: var(--danger) }
.nx-btn.icon { padding: 7px 9px }
.nx-btn[disabled] { opacity: .55; cursor: default }

.nx-input {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm);
    padding: 8px 10px; width: 100%; transition: border-color var(--ease);
}
.nx-input:focus { border-color: var(--accent); outline: none }

.nx-label { color: var(--muted); font-size: var(--text-sm) }
.nx-field { display: flex; flex-direction: column; gap: var(--sp-1); margin-bottom: var(--sp-3) }
.nx-actions { display: flex; gap: var(--sp-2); margin-top: var(--sp-2) }
.nx-toolbar { display: flex; gap: var(--sp-2); align-items: center; flex-wrap: wrap }
.nx-check { display: inline-flex; gap: var(--sp-2); align-items: center; accent-color: var(--accent) }
input[type="checkbox"] { accent-color: var(--accent) }
`

export default controls
