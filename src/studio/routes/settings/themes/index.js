/** /settings/themes — the appearance page: mode (auto/light/dark) and the
 *  accent color. Both are numbers on :root (the akao channel rule) — no
 *  reload, no server round-trip. */

import { mountTemplate, button, icon } from "../../../kit/index.js"
import { ACCENTS } from "../../../kit/theme.js"
import { themesTemplate } from "./template.js"

const MODES = [
    { mode: "auto", icon: "circle-half" },
    { mode: "light", icon: "sun" },
    { mode: "dark", icon: "moon" }
]

export function render(ctx) {
    const c = {}
    const host = mountTemplate(themesTemplate(c))

    const paintModes = () => {
        c.$modes.replaceChildren(...MODES.map((m) =>
            button({ variant: "option", iconName: m.icon, onclick: () => { ctx.theme.set(m.mode); paintModes() } }, [m.mode])
        ))
        for (const [i, node] of [...c.$modes.children].entries())
            node.toggleAttribute("data-on", MODES[i].mode === ctx.theme.value)
    }

    const paintAccents = () => {
        c.$accents.replaceChildren(...ACCENTS.map((a) => {
            const swatch = document.createElement("span")
            swatch.className = "nx-swatch"
            swatch.style.background = `hsl(${a.h} ${a.s} 45%)`
            return button({ variant: "option", onclick: () => { ctx.theme.setAccent(a.name); paintAccents() } }, [swatch, a.name])
        }))
        for (const [i, node] of [...c.$accents.children].entries())
            node.toggleAttribute("data-on", ACCENTS[i].name === ctx.theme.accent)
    }

    paintModes()
    paintAccents()
    return host
}
