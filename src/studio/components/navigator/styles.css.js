/**
 * <nx-navigator> styles — the akao orbital navigator, faithful mechanics:
 * planets sit on a circle by pure CSS trigonometry (--deg = 360°/total × i,
 * x = sin·rad, y = −cos·rad); nesting cascades --level through slots and
 * --active (open depth up the ancestor chain) widens every ring. Opening
 * translates the system by (−x, −y): a SUB-orbit recenters onto the
 * system's heart, the ROOT rises from the bottom to the screen center
 * (--center, svmin — the original), the hamburger morphs to an X, and a
 * planet's icon flies back out to its orbit seat. Original spring:
 * cubic-bezier(0, -2, 1, 2).
 */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host {
        --size: var(--icon-lg, 2.75rem);
        --step: calc(var(--size) * 1.5);
        --level: 0;
        --active: -1;
        --rad: calc(var(--step) * (var(--active) - var(--level) + 1));
        --center: calc(50svmin - var(--size) * 0.5);
        --transition: var(--speed, 160ms) cubic-bezier(0, -2, 1, 2);
        display: flex;
        justify-content: center;
        align-items: center;
        width: var(--size);
        aspect-ratio: 1 / 1;
        border-radius: 50%;
    }
    nav {
        display: flex; align-items: center; justify-content: center;
        transition: var(--transition);
        width: var(--size); aspect-ratio: 1 / 1; border-radius: 50%;
    }
    nav:has(#state:checked) {
        transform: translate(calc(var(--x, 0px) * -1), calc(var(--y, var(--center)) * -1));
    }
    nav:has(#state:checked) #orbit { width: calc(var(--rad, 0px) * 2); opacity: 1 }
    /* the original readability veil: a blurred disc grows BEHIND the open
       orbit and softly covers what's underneath (akao #orbit::before) */
    nav:has(#state:checked) #orbit::before {
        --glow: calc((var(--rad, 0px) * 2) + var(--size) * 2);
        position: absolute;
        border-radius: 50%;
        content: "";
        aspect-ratio: 1 / 1;
        width: var(--glow);
        top: calc(50% - var(--glow) / 2);
        left: calc(50% - var(--glow) / 2);
        background: var(--bg);
        filter: blur(calc(var(--glow) * 0.125));
        z-index: -1;
        transition: var(--transition);
        opacity: 0.92;
    }
    #orbit {
        border-radius: 50%;
        border: var(--border-width, 1px) solid var(--border);
        position: absolute; aspect-ratio: 1 / 1; width: 0px; opacity: 0;
        transition: var(--transition); pointer-events: none;
    }
    #toggle {
        background: var(--surface);
        border: var(--border-width, 1px) solid var(--border);
        box-shadow: var(--shadow);
        transition: var(--transition);
        width: var(--size); height: var(--size); border-radius: 50%;
        display: flex; flex-direction: column; justify-content: center; align-items: center;
        cursor: pointer; position: absolute;
        z-index: calc(var(--level) - var(--active) + 75);
    }
    #toggle:hover { background: var(--surface-2) }
    #toggle:hover span { background: var(--accent) }
    #toggle nx-icon {
        position: absolute; display: flex; pointer-events: auto;
        border-radius: 50%; transition: var(--transition); color: var(--muted);
    }
    #toggle nx-icon:not([name]) { display: none }
    #toggle:hover nx-icon { color: var(--accent) }
    #toggle nx-icon:active, #toggle div { pointer-events: none }
    #toggle div {
        width: 50%; aspect-ratio: 1 / 1; border-radius: 50%;
        display: flex; align-items: center; justify-content: center; position: relative;
    }
    #toggle div span {
        position: absolute; height: 1px; width: 100%;
        transition: var(--transition); background: var(--text);
    }
    #toggle div span:nth-child(1) { transform: translateY(calc(var(--size) * 0.15)) }
    #toggle div span:nth-child(3) { transform: translateY(calc(var(--size) * -0.15)) }
    /* an icon-bearing toggle shows its icon, not the hamburger, when closed */
    nav:has(nx-icon[name]) #toggle div span { opacity: 0 }
    #state { appearance: none; display: none }

    /* ── open ── */
    #state:checked ~ #toggle nx-icon {
        transform: translate(var(--x, 0px), var(--y, var(--center)));
    }
    #state:checked ~ #toggle div span {
        opacity: 1; display: flex;
    }
    #state:checked ~ #toggle div span:nth-child(1) { transform: translateY(0) rotate(45deg) }
    #state:checked ~ #toggle div span:nth-child(2) { opacity: 0 }
    #state:checked ~ #toggle div span:nth-child(3) { transform: translateY(0) rotate(-45deg) }

    section {
        aspect-ratio: 1 / 1; display: flex; align-items: center; justify-content: center;
        position: absolute;
    }
    slot {
        display: flex; align-items: center; opacity: 0;
        width: var(--size); aspect-ratio: 1 / 1; position: absolute;
        transition: var(--transition); border-radius: 50%;
        pointer-events: none;
    }
    slot::slotted(*) {
        opacity: 0;
        background: var(--surface);
        width: var(--size); aspect-ratio: 1 / 1;
        position: absolute; display: flex; align-items: center; justify-content: center;
        transition: var(--transition); border-radius: 50%;
        pointer-events: none;
        box-shadow: var(--shadow);
    }
    #state:checked ~ section slot {
        opacity: 1;
        pointer-events: auto;
        --tmp-level: var(--level);
        --tmp-rad: var(--rad);
        --tmp-active: var(--active);
        --tmp-total: var(--total, 0);
    }
    #state:checked ~ section slot::slotted(*) {
        border: var(--border-width, 1px) solid var(--border);
        opacity: 1;
        pointer-events: auto;
        --deg: calc(360deg / var(--tmp-total) * (var(--i, 0) - 1));
        --x: calc(sin(var(--deg)) * var(--tmp-rad));
        --y: calc(cos(var(--deg)) * var(--tmp-rad) * -1);
        --level: calc(var(--tmp-level) + 1);
        --active: var(--tmp-active);
        transform: translate(var(--x), var(--y));
    }
`

export default STYLE
