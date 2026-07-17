/**
 * The Studio shell layout — topbar spanning, sidebar left, main right; the
 * sidebar collapses to an off-canvas drawer under 860px (akao layouts pattern:
 * the layout's css lives with the layout).
 */

export const shell = /* css */ `
* { box-sizing: border-box }
html, body { margin: 0; padding: 0 }
body { font-family: var(--font); font-size: var(--text-md); background: var(--bg); color: var(--text); line-height: 1.5; -webkit-text-size-adjust: 100% }

.nx-top {
    position: sticky; top: 0; z-index: 30; display: flex; gap: var(--sp-3); align-items: center;
    padding: 10px 14px; background: color-mix(in srgb, var(--surface) 92%, transparent);
    backdrop-filter: saturate(1.4) blur(8px); border-bottom: 1px solid var(--border);
}
.nx-brand { font-weight: 700; letter-spacing: -0.01em }
.nx-brand .hex { color: var(--accent) }
.nx-brand small { color: var(--muted); font-weight: 500 }

.nx-app { display: block }
.nx-side {
    position: fixed; top: 0; left: 0; bottom: 0; width: min(84vw, 300px); z-index: 50;
    background: var(--surface); border-right: 1px solid var(--border);
    transform: translateX(-100%); transition: transform var(--ease); overflow-y: auto; padding: 14px;
}
.nx-app.open .nx-side { transform: none }
.nx-scrim {
    position: fixed; inset: 0; background: rgba(2, 6, 23, .45); z-index: 40;
    opacity: 0; pointer-events: none; transition: opacity var(--ease);
}
.nx-app.open .nx-scrim { opacity: 1; pointer-events: auto }
.nx-main { padding: 16px 14px 60px; min-width: 0 }

.nx-grouplabel { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: 14px 6px 6px }
.nx-nav a {
    display: flex; gap: 9px; align-items: center; padding: 8px 10px; border-radius: var(--radius-sm);
    color: inherit; text-decoration: none; cursor: pointer; border-left: 2px solid transparent;
}
.nx-nav a:hover { background: var(--surface-2) }
.nx-nav a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; border-left-color: var(--accent) }
.nx-nav a .ico { width: 18px; text-align: center }

@media (min-width: 860px) {
    .nx-hamb { display: none }
    .nx-app { display: grid; grid-template-columns: 248px 1fr }
    .nx-top { grid-column: 1 / -1 }
    .nx-side { grid-column: 1; position: sticky; top: 57px; height: calc(100vh - 57px); transform: none; width: auto; z-index: 1 }
    .nx-scrim { display: none }
    .nx-main { grid-column: 2; padding: 22px 26px 80px }
}

/* drawer (right panel) */
.nx-drawer { position: fixed; inset: 0; z-index: 60; display: none }
.nx-drawer.show { display: block }
.nx-drawer-back { position: absolute; inset: 0; background: rgba(2, 6, 23, .45) }
.nx-drawer-panel {
    position: absolute; top: 0; right: 0; bottom: 0; width: min(94vw, 460px);
    background: var(--surface); border-left: 1px solid var(--border); box-shadow: var(--shadow);
    padding: 18px; overflow-y: auto;
}
.nx-drawer-panel h2 { margin: 0 0 12px; font-size: var(--text-lg) }

/* login + toasts */
.nx-login { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; background: var(--bg); padding: 20px }
.nx-login[hidden] { display: none }
.nx-toasts { position: fixed; bottom: 16px; right: 16px; z-index: 90; display: flex; flex-direction: column; gap: 8px; max-width: min(92vw, 380px) }
.nx-toast {
    background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--accent);
    border-radius: var(--radius-sm); box-shadow: var(--shadow); padding: 10px 14px; font-size: var(--text-md);
    transition: opacity var(--ease);
}
.nx-toast.ok { border-left-color: var(--ok) }
.nx-toast.err { border-left-color: var(--danger) }

.nx-form .nx-field { max-width: 420px }
footer.nx-foot { color: var(--muted); font-size: var(--text-sm); border-top: 1px solid var(--border); margin: 24px 14px; padding-top: 14px }
footer.nx-foot code { font-family: var(--mono); background: var(--surface-2); padding: .1em .4em; border-radius: 5px }
@media (min-width: 860px) { footer.nx-foot { margin-left: 274px } }
`

export default shell
