/**
 * The Studio shell layout — topbar spanning, sidebar left, main right; the
 * sidebar collapses to an off-canvas drawer under 53.75rem (akao layouts pattern:
 * the layout's css lives with the layout).
 */

export const shell = /* css */ `
* { box-sizing: border-box }
html, body { margin: 0; padding: 0 }
body { font-family: var(--font); font-size: var(--text-md); background: var(--bg); color: var(--text); line-height: 1.5; -webkit-text-size-adjust: 100% }

/* ── the app shell IS a grid: rows auto/1fr, areas top/side/main, the shell
   locked to the viewport and MAIN scrolling inside its track — no sticky,
   no calc(), no header-height magic anywhere ─────────────────────────────── */
.nx-app {
    display: grid; height: 100dvh;
    grid-template-rows: auto 1fr;
    grid-template-columns: 1fr;
    grid-template-areas: "top" "main";
}
.nx-top { grid-area: top; z-index: 30; display: flex; gap: 0; align-items: center; padding: 0; background: var(--surface) }
.nx-brand { font-weight: 700; letter-spacing: -0.01em; margin-left: var(--sp-3); margin-right: auto }
.nx-brand .hex { color: var(--accent); display: inline-flex; vertical-align: -0.1875rem; --icon: 1.375rem }
.nx-login .hex { --icon: 1.5rem }
.nx-brand small { color: var(--muted); font-weight: 500 }

/* mobile: the side is an off-canvas overlay above the grid */
.nx-side {
    position: fixed; top: 0; left: 0; bottom: 0; width: min(84vw, 18.75rem); z-index: 50;
    background: var(--surface);
    transform: translateX(-100%); transition: transform var(--ease); overflow-y: auto; overflow-x: hidden;
}
.nx-app.open .nx-side { transform: none }
.nx-scrim {
    position: fixed; inset: 0; background: hsl(var(--h1) 84% 5% / 0.45); z-index: 40;
    opacity: 0; pointer-events: none; transition: opacity var(--ease);
}
.nx-app.open .nx-scrim { opacity: 1; pointer-events: auto }
.nx-main { grid-area: main; overflow-y: auto; padding: 1rem 0.875rem 3.75rem; min-width: 0 }

.nx-grouplabel { font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .08em; color: var(--muted); margin: var(--sp-3) var(--sp-2) var(--sp-1); overflow: hidden; white-space: nowrap }
.nx-nav nx-navlink { display: block }
.nx-nav a {
    display: flex; align-items: center; padding: 0;
    color: inherit; text-decoration: none; cursor: pointer;
}
.nx-nav a:hover { background: var(--surface-2) }
.nx-nav a.active { background: var(--accent-soft); color: var(--accent); font-weight: 600; box-shadow: inset 0.125rem 0 0 var(--accent) }
.nx-nav a .ico {
    width: var(--control-h); height: var(--control-h); flex: none;
    display: inline-flex; align-items: center; justify-content: center;
}
.nx-nav a .lbl { padding-right: var(--sp-3); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
/* settings children — the INDENT lives on the label (the icon cell is
   sacred: identical in every level and every rail state) */
.nx-nav a.sub .lbl { padding-left: var(--sp-2); font-size: var(--text-sm) }
.nx-nav a.sub .ico { opacity: .75 }

.nx-navtoggle { display: none }
.nx-searchbar {
    position: fixed; top: 3.4375rem; left: 50%; transform: translateX(-50%);
    width: min(92vw, 40rem); max-height: min(70vh, 30rem); overflow: auto;
    box-sizing: border-box; z-index: 70;
    background: var(--surface); box-shadow: var(--shadow); padding: var(--sp-3);
}
.nx-searchbar[hidden] { display: none }

@media (min-width: 53.75rem) {
    .nx-hamb { display: none }
    .nx-navtoggle { display: inline-flex }
    /* the side joins the grid as its own AREA — full height by construction.
       THREE levels (full -> icons -> off): only the COLUMN WIDTH changes;
       the icon cells keep their exact geometry in every state, so the rail
       always lines up with the square controls in the header */
    .nx-app { grid-template-columns: 15.5rem 1fr; grid-template-areas: "top top" "side main" }
    .nx-app[data-nav="icons"] { grid-template-columns: var(--control-h) 1fr }
    .nx-app[data-nav="icons"] .nx-grouplabel { visibility: hidden; height: var(--sp-2); margin: var(--sp-2) 0 0 }
    .nx-app[data-nav="icons"] .nx-nav a .lbl { display: none }
    .nx-app[data-nav="off"] { grid-template-columns: 0 1fr }
    .nx-app[data-nav="off"] .nx-side { display: none }
    .nx-side { grid-area: side; position: static; transform: none; width: auto; z-index: 1 }
    .nx-scrim { display: none }
    .nx-main { padding: 1.375rem 1.625rem 5rem }
}

/* drawer (right panel) */
.nx-drawer { position: fixed; inset: 0; z-index: 60; display: none }
.nx-drawer.show { display: block }
.nx-drawer-back { position: absolute; inset: 0; background: hsl(var(--h1) 84% 5% / 0.45) }
.nx-drawer-panel {
    position: absolute; top: 0; right: 0; bottom: 0; width: min(94vw, 28.75rem);
    background: var(--surface); box-shadow: var(--shadow);
    padding: 1.125rem; overflow-y: auto;
}
.nx-drawer-panel h2 { margin: 0 0 0.75rem; font-size: var(--text-lg) }

/* login + toasts */
.nx-login { position: fixed; inset: 0; z-index: 80; display: flex; align-items: center; justify-content: center; background: var(--bg); padding: 1.25rem }
.nx-login[hidden] { display: none }
.nx-toasts { position: fixed; bottom: 1rem; right: 1rem; z-index: 90; display: flex; flex-direction: column; gap: 0.5rem; max-width: min(92vw, 23.75rem) }
.nx-toast {
    background: var(--surface); box-shadow: inset 0.1875rem 0 0 var(--accent), var(--shadow); padding: 0.625rem 0.875rem; font-size: var(--text-md);
    transition: opacity var(--ease);
}
.nx-toast.ok { box-shadow: inset 0.1875rem 0 0 var(--ok), var(--shadow) }
.nx-toast.err { box-shadow: inset 0.1875rem 0 0 var(--danger), var(--shadow) }

.nx-form { max-width: 26.25rem }
footer.nx-foot { color: var(--muted); font-size: var(--text-sm); margin: 1.5rem 0.875rem; padding-top: 0.875rem }
footer.nx-foot code { font-family: var(--mono); background: var(--surface-2); padding: .1em .4em}
@media (min-width: 53.75rem) { footer.nx-foot { margin-left: 17.125rem } }
`

export default shell
