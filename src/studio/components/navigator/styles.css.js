/**
 * <nx-navigator> styles — the akao orbital navigator, verbatim mechanics:
 * children sit on a circle by pure CSS trigonometry (--deg = 360°/total × i,
 * x = sin·rad, y = cos·rad), nesting cascades --level through slots, and
 * --active (open depth, counted up the ancestor chain) grows the orbit
 * radius — a solar system that lays itself out as children are added.
 */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host {
        --size: var(--icon-lg, 2.75rem);
        --step: calc(var(--size) * 1.5);
        --level: 0;
        --active: -1;
        --rad: calc(var(--step) * (var(--active) - var(--level) + 1));
        --transition: var(--speed, 160ms) cubic-bezier(0, -1.2, 1, 1.6);
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
    /* the akao recentering trick: an opened navigator translates by (-x,-y) —
       a SUB-orbit slides back onto the system's center; the root (no --x/--y
       from a parent) lifts diagonally off its corner so rings never clip. */
    nav:has(#state:checked) {
        transform: translate(calc(var(--x, 22svmin) * -1), calc(var(--y, 22svmin) * -1));
    }
    nav:has(#state:checked) #orbit { width: calc(var(--rad, 0px) * 2); opacity: 1 }
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
        z-index: calc(var(--level) - var(--active) + 70);
    }
    #toggle:hover { border-color: var(--accent) }
    #toggle nx-icon { pointer-events: none; color: var(--muted) }
    #state { appearance: none; display: none }
    #state:checked ~ #toggle nx-icon { color: var(--accent) }
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
