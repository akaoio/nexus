/**
 * <nx-navigator> styles — VISUALS only. Positioning (which planet sits where,
 * open/closed offsets, opacity) is driven in JS (index.js #layout) for
 * determinism; CSS owns the look: the round toggle, the hamburger that morphs
 * to an X, the orbit ring with its blurred readability veil, and the smooth
 * transition every inline transform rides.
 */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host {
        --size: var(--icon-lg, 2.75rem);
        --transition: var(--speed, 160ms) cubic-bezier(.2, .7, .3, 1.4);
        display: inline-flex; justify-content: center; align-items: center;
        width: var(--size); aspect-ratio: 1 / 1; border-radius: 50%;
        transition: transform var(--transition), opacity var(--transition);
    }
    nav {
        display: flex; align-items: center; justify-content: center;
        width: var(--size); aspect-ratio: 1 / 1; border-radius: 50%;
    }
    /* the orbit ring + its blurred veil appear when open (JS sets --rad) */
    #orbit {
        position: absolute; aspect-ratio: 1 / 1; width: 0; opacity: 0;
        border: var(--border-width, 1px) solid var(--border); border-radius: 50%;
        transition: width var(--transition), opacity var(--transition); pointer-events: none;
    }
    nav:has(#state:checked) #orbit { width: calc(var(--rad, 0px) * 2); opacity: 1 }
    nav:has(#state:checked) #orbit::before {
        --glow: calc((var(--rad, 0px) * 2) + var(--size) * 2);
        content: ""; position: absolute; border-radius: 50%; aspect-ratio: 1 / 1;
        width: var(--glow); top: calc(50% - var(--glow) / 2); left: calc(50% - var(--glow) / 2);
        background: var(--bg); filter: blur(calc(var(--glow) * 0.125)); opacity: .92; z-index: -1;
        transition: var(--transition);
    }

    #toggle {
        position: absolute; width: var(--size); height: var(--size); border-radius: 50%;
        background: var(--surface); border: var(--border-width, 1px) solid var(--border);
        box-shadow: var(--shadow); cursor: pointer;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        transition: background var(--transition), border-color var(--transition);
    }
    #toggle:hover { border-color: var(--accent) }
    #toggle:hover span { background: var(--accent) }
    #toggle nx-icon { color: var(--muted); pointer-events: none }
    #toggle nx-icon:not([name]) { display: none }
    #toggle:hover nx-icon { color: var(--accent) }
    /* an icon-bearing toggle hides its hamburger until open */
    nav:has(nx-icon[name]) #toggle > div { display: none }
    nav:has(#state:checked) nx-icon[name] { display: none }
    nav:has(#state:checked) #toggle > div { display: flex }

    #toggle > div {
        width: 50%; aspect-ratio: 1 / 1; border-radius: 50%; position: relative;
        display: flex; align-items: center; justify-content: center; pointer-events: none;
    }
    #toggle > div span {
        position: absolute; height: 1px; width: 100%; background: var(--text);
        transition: var(--transition);
    }
    #toggle > div span:nth-child(1) { transform: translateY(calc(var(--size) * 0.15)) }
    #toggle > div span:nth-child(3) { transform: translateY(calc(var(--size) * -0.15)) }
    /* open → the three bars morph into an X */
    #state:checked ~ #toggle > div span:nth-child(1) { transform: translateY(0) rotate(45deg) }
    #state:checked ~ #toggle > div span:nth-child(2) { opacity: 0 }
    #state:checked ~ #toggle > div span:nth-child(3) { transform: translateY(0) rotate(-45deg) }

    #state { appearance: none; display: none }

    section { position: absolute; display: flex; align-items: center; justify-content: center }
    slot { display: contents }
    /* slotted planets: appearance only — position/opacity are JS-driven */
    slot::slotted(*) {
        position: absolute;
        width: var(--size); aspect-ratio: 1 / 1; border-radius: 50%;
        background: var(--surface); box-shadow: var(--shadow);
        display: flex; align-items: center; justify-content: center;
        opacity: 0; pointer-events: none;
        transition: transform var(--transition), opacity var(--transition);
    }
`

export default STYLE
