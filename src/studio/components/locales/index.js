/**
 * <nx-locales> — the akao locales component AS AN ORBIT: it IS a navigator
 * planet whose children are the languages. The list is LOADED from the built
 * statics (/_nexus/statics/locales.json ← src/i18n/dict/locales.yaml: YAML
 * for humans+machines in src, JSON on the wire — components never hardcode),
 * offline-cached in IndexedDB. Selecting calls NxLocales.onSelect(code).
 */

import { NxNavigator } from "../navigator/index.js"
import { cached, remember } from "../../app/cache.js"
import NxContext from "../context/index.js"

export class NxLocales extends NxNavigator {
    static onSelect = null

    constructor() {
        super()
        if (!this.dataset.icon) this.dataset.icon = "translate"
    }

    async connectedCallback() {
        super.connectedCallback()
        let list = await cached("statics:locales")
        if (list) this.paint(list)
        try {
            const fresh = await (await fetch("/_nexus/statics/locales.json")).json()
            await remember("statics:locales", fresh)
            this.paint(fresh)
        } catch {
            if (!list) this.paint([{ code: "en", name: "English" }])
        }
    }

    paint(list) {
        this.replaceChildren(...list.map(({ code, name }) => {
            const planet = document.createElement("button")
            planet.type = "button"
            planet.title = name
            planet.textContent = code
            planet.className = code === NxContext.locale ? "on" : ""
            planet.addEventListener("click", () => NxLocales.onSelect?.(code))
            return planet
        }))
    }
}

if (typeof customElements !== "undefined" && !customElements.get("nx-locales")) customElements.define("nx-locales", NxLocales)

export default NxLocales
