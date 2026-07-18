/**
 * The i18n data store — <nx-context> renders it; this only HOLDS locale +
 * bundle. "locale" is THE akao localStorage key: the kernel Router reads the
 * same one, so a visit to the bare root reopens in the REMEMBERED language.
 */

import NxContext from "../components/context/index.js"

export function createI18n(bundle) {
    const names = bundle?.names ?? {}
    const locales = bundle?.locales ?? ["en"]
    let locale = localStorage.getItem("locale")
    const guess = (navigator.language || "en").slice(0, 2)
    if (!locales.includes(locale)) locale = locales.includes(guess) ? guess : "en"
    NxContext.bundle({ dict: bundle?.dict ?? {}, locale })
    return {
        locales, names,
        /** Programmatic strings (toasts, confirms) resolve through the SAME memory. */
        resolve: (key, fallback, args) => NxContext.resolve(key, fallback, args),
        get locale() { return locale },
        set(next) {
            locale = next
            localStorage.setItem("locale", next)
            document.documentElement.lang = next
            NxContext.setLocale(next)
        }
    }
}

export default { createI18n }
