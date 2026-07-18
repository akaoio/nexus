/** /settings/locales — pick the UI language. The list is the i18n bundle the
 *  server booted us with (dict coverage IS the availability truth). */

import { mountTemplate, button } from "../../../kit/index.js"
import { localesTemplate } from "./template.js"

export function render(ctx) {
    const c = {}
    const host = mountTemplate(localesTemplate(c))
    const paint = () => {
        c.$body.replaceChildren(...ctx.i18n.locales.map((code) =>
            button({
                variant: "option",
                onclick: () => {
                    ctx.i18n.set(code)
                    // repaint under the new locale prefix (/vi/settings/locales/)
                    ctx.navigate("settings", null, "locales")
                }
            }, [
                Object.assign(document.createElement("strong"), { textContent: code }),
                Object.assign(document.createElement("span"), { className: "nx-muted", textContent: ctx.i18n.names[code] || code })
            ])
        ))
        for (const node of c.$body.children) node.toggleAttribute("data-on", node.querySelector("strong").textContent === ctx.i18n.locale)
    }
    paint()
    return host
}
