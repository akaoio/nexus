/** Shared small parts — cards, chips, empty states, rows, sections. */

export const bits = /* css */ `
.nx-card {
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    box-shadow: var(--shadow); padding: var(--sp-4); margin-bottom: var(--sp-4);
}
.nx-head { display: flex; gap: var(--sp-3); align-items: center; flex-wrap: wrap; margin-bottom: var(--sp-4) }
.nx-head h1 { font-size: var(--text-xl); margin: 0; letter-spacing: -0.01em }
.nx-chip {
    font-family: var(--mono); font-size: var(--text-xs); padding: 0.1875rem 0.5625rem; border-radius: 62.4375rem;
    border: 1px solid var(--border); color: var(--muted); white-space: nowrap;
}
.nx-chip.on { color: var(--ok); border-color: color-mix(in srgb, var(--ok) 40%, var(--border)) }
.nx-chip.accent { color: var(--accent); border-color: color-mix(in srgb, var(--accent) 45%, var(--border)) }
.nx-muted { color: var(--muted) }
.nx-err { color: var(--danger); white-space: pre-wrap; margin: 0.375rem 0 }
.nx-spacer { flex: 1 }
.nx-empty { text-align: center; padding: var(--sp-6) var(--sp-4); color: var(--muted) }
.nx-empty .nx-hex { display: block; margin: 0 auto var(--sp-3); opacity: .8 }
.nx-out {
    background: var(--surface-2); border: 1px solid var(--border); padding: var(--sp-3);
    border-radius: var(--radius-sm); overflow: auto; font-family: var(--mono); font-size: var(--text-sm); max-height: 20rem;
}
.nx-row { display: flex; gap: 0.625rem; align-items: center; padding: var(--sp-2) 0; border-top: 1px solid var(--border) }
.nx-who { flex: 1; min-width: 0 }
.nx-pub { font-family: var(--mono); font-size: var(--text-sm); color: var(--muted); overflow: hidden; text-overflow: ellipsis; white-space: nowrap }
/* collection views */
.nx-scroll { overflow-x: auto; max-width: 100% }
.nx-table th.nx-selcol, .nx-table td.nx-selcol { width: 2.125rem; position: sticky; left: 0; background: var(--surface); z-index: 1 }
.nx-table th.nx-selcol { background: var(--surface-2) }
.nx-table tr.selected td { background: var(--accent-soft) }
.nx-table th[draggable="true"] { cursor: grab }
.nx-bulkbar[hidden] { display: none }
.nx-bulkbar {
    display: flex; gap: var(--sp-2); align-items: center; flex-wrap: wrap;
    background: var(--accent-soft); border: 1px solid color-mix(in srgb, var(--accent) 40%, var(--border));
    border-radius: var(--radius-sm); padding: var(--sp-2) var(--sp-3); margin-bottom: var(--sp-3);
}
.nx-kanban { display: flex; gap: var(--sp-3); align-items: flex-start; min-height: 12.5rem }
.nx-lane { background: var(--surface-2); border: 1px solid var(--border); border-radius: var(--radius); padding: var(--sp-2); min-width: 13.75rem; flex: 1 }
.nx-lane-head { display: flex; gap: var(--sp-2); align-items: center; justify-content: space-between; padding: 0.125rem 0.25rem 0.5rem }
.nx-lane-cards { display: flex; flex-direction: column; gap: var(--sp-2); min-height: 2.5rem }
.nx-kcard { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); padding: var(--sp-2) var(--sp-3); cursor: grab; box-shadow: var(--shadow) }
.nx-kcard.selected { border-color: var(--accent) }
.nx-kcard-title { margin-bottom: 0.125rem }

/* orbital navigator planets (light-DOM children of nx-navigator) */
.nx-orbit {
    position: fixed; bottom: 0; left: 0; width: 100%;
    display: flex; justify-content: center; align-items: center;
    padding: var(--sp-2) 0; z-index: 75; pointer-events: none;
}
.nx-orbit > * { pointer-events: auto }
nx-navigator .nx-planet {
    font: inherit; color: var(--text); background: none; border: none; cursor: pointer;
    width: 100%; height: 100%; border-radius: 50%;
    display: flex; align-items: center; justify-content: center;
    font-family: var(--mono); font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .04em;
}
nx-navigator .nx-planet:hover { color: var(--accent) }
nx-navigator .nx-planet.on { color: var(--accent); font-weight: 700 }

.nx-setsec { margin-bottom: var(--sp-5) }
.nx-setsec h3 {
    font-size: var(--text-xs); text-transform: uppercase; letter-spacing: .07em; color: var(--muted);
    margin: 0 0 0.625rem; border-bottom: 1px solid var(--border); padding-bottom: 0.375rem;
}
`

/** The signature hexagon — the empty-state mark. `size` in px. */
export const hexSVG = (size = 44) => `
<svg class="nx-hex" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" aria-hidden="true">
  <path d="M12 2.5 20.2 7.25v9.5L12 21.5 3.8 16.75v-9.5L12 2.5Z" stroke="var(--accent)" stroke-width="1.4"/>
  <path d="M12 7.1 16.3 9.55v4.9L12 16.9 7.7 14.45v-4.9L12 7.1Z" stroke="var(--border)" stroke-width="1.2"/>
</svg>`

export default bits
