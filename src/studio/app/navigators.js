/**
 * Orbit controllers — populate the two <nx-navigator> planets (locales,
 * themes) with their children. They must be PLAIN nx-navigator elements
 * (same tag as the root) so the akao ancestor-walk in active() works; the
 * planets themselves are plain <button>s, and selecting one calls back.
 *
 * The locale list comes from BUILT statics (/_nexus/statics/locales.json ←
 * src/i18n/dict/locales.yaml: YAML in src, JSON on the wire) and is cached
 * in IndexedDB for offline.
 */

import { icon } from "./lib.js"
import { cached, remember } from "./cache.js"

const planet = (label, title, onClick, on) => {
    const button = document.createElement("button")
    button.type = "button"
    button.className = "nx-planet" + (on ? " on" : "")
    button.title = title
    button.append(label)
    button.addEventListener("click", onClick)
    return button
}

/** Fill the locales navigator from the statics; selecting sets the locale. */
export async function mountLocales(nav, { current, onSelect }) {
    const paint = (list) =>
        nav.replaceChildren(...list.map((l) =>
            planet(document.createTextNode(l.code), l.name, () => onSelect(l.code), l.code === current)
        ))

    const held = await cached("statics:locales")
    if (held) paint(held)
    try {
        const list = await (await fetch("/_nexus/statics/locales.json")).json()
        await remember("statics:locales", list)
        paint(list)
    } catch {
        if (!held) paint([{ code: "en", name: "English" }])
    }
}

/** Fill the themes navigator with auto / light / dark. */
export function mountThemes(nav, { current, onSelect }) {
    const MODES = [
        { mode: "auto", name: "circle-half" },
        { mode: "light", name: "sun" },
        { mode: "dark", name: "moon" }
    ]
    nav.replaceChildren(...MODES.map((m) =>
        planet(icon(m.name), m.mode, () => onSelect(m.mode), m.mode === current)
    ))
}

export default { mountLocales, mountThemes }
