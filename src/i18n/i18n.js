/**
 * i18n — translation memory (ARCHITECTURE.md §5.1, line "i18n/*.yaml — cùng
 * format akao (mỗi key một file, per-locale build)"). akao's model, faithfully:
 * every UI string is ONE file, `i18n/<key>.yaml`, holding all its locales:
 *
 *     # i18n/save.yaml
 *     en: Save
 *     vi: Lưu
 *     ja: 保存
 *
 * One source of truth per string, trivial to translate. This module is the
 * zero-dependency runtime: a flat-YAML reader (the files are just key: value),
 * a dictionary loader, and `t()` with a fallback chain (locale → en → key).
 *
 * Runtime resolution suits the server-rendered Studio and any isomorphic
 * component; the same dictionary can be compiled to per-locale static builds
 * for production, exactly like akao — the FORMAT is what's frozen.
 */

/**
 * Parse a flat YAML map (one `key: value` per line — the i18n file shape).
 * Values keep everything after the first colon; surrounding quotes are stripped.
 * Comments (#) and blank lines are ignored. No nesting, anchors, or block
 * scalars — i18n files never need them, so this stays tiny and dependency-free.
 * @param {string} text
 * @returns {Object<string,string>}
 */
export function parseFlatYaml(text) {
    const out = {}
    for (const raw of String(text).split(/\r?\n/)) {
        const line = raw.replace(/\s+$/, "")
        if (!line || line.trimStart().startsWith("#")) continue
        const colon = line.indexOf(":")
        if (colon === -1) continue
        const key = line.slice(0, colon).trim()
        if (!key) continue
        let value = line.slice(colon + 1).trim()
        if (value.length >= 2 && ((value[0] === '"' && value.at(-1) === '"') || (value[0] === "'" && value.at(-1) === "'")))
            value = value.slice(1, -1)
        out[key] = value
    }
    return out
}

/**
 * Load a dictionary from a directory of `<key>.yaml` files (akao format).
 * Node-only (uses fs lazily). `locales.yaml`/`locale.yaml` are treated as the
 * locale-name registry, not translation keys.
 * @param {string} dir
 * @returns {{dict: Object<string,Object<string,string>>, locales: Object<string,string>}}
 */
export function loadDictionary(dir) {
    const fs = process.getBuiltinModule("fs")
    const path = process.getBuiltinModule("path")
    const dict = {}
    let locales = {}
    if (!fs.existsSync(dir)) return { dict, locales }
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".yaml") && !file.endsWith(".yml")) continue
        const key = file.replace(/\.ya?ml$/, "")
        const parsed = parseFlatYaml(fs.readFileSync(path.join(dir, file), "utf8"))
        if (key === "locales" || key === "locale") locales = { ...locales, ...parsed }
        else dict[key] = parsed
    }
    return { dict, locales }
}

/** Merge dictionaries (later wins per key/locale) — framework + instance. */
export function mergeDictionaries(...dicts) {
    const out = {}
    for (const d of dicts) for (const key of Object.keys(d ?? {})) out[key] = { ...out[key], ...d[key] }
    return out
}

/**
 * Resolve a key in a locale, falling back locale → en → the provided fallback →
 * the key itself. Never throws; a missing key returns something showable.
 * @param {Object} dict
 * @param {string} key
 * @param {string} [locale="en"]
 * @param {string} [fallback]
 */
export function t(dict, key, locale = "en", fallback) {
    const entry = dict?.[key]
    if (entry) {
        if (entry[locale] != null) return entry[locale]
        if (entry.en != null) return entry.en
        const first = Object.values(entry)[0]
        if (first != null) return first
    }
    return fallback ?? key
}

/** A translator bound to a dictionary + locale: `const _ = translator(dict, "vi")`. */
export function translator(dict, locale = "en") {
    return (key, fallback) => t(dict, key, locale, fallback)
}

/** Which locales does a dictionary actually cover (union across all keys)? */
export function coveredLocales(dict) {
    const set = new Set()
    for (const key of Object.keys(dict ?? {})) for (const locale of Object.keys(dict[key])) set.add(locale)
    return [...set].sort()
}

/** Built-in locale-name registry (code → endonym); instances may extend it. */
export const LOCALE_NAMES = Object.freeze({
    en: "English", vi: "Tiếng Việt", fr: "Français", es: "Español",
    de: "Deutsch", ja: "日本語", zh: "中文", ko: "한국어", pt: "Português",
    ru: "Русский", ar: "العربية", hi: "हिन्दी", it: "Italiano", th: "ไทย"
})

/** Human name of a locale code, from a registry (defaults to the built-in). */
export function localeName(code, names = LOCALE_NAMES) {
    return names[code] ?? code
}

export default { parseFlatYaml, loadDictionary, mergeDictionaries, t, translator, coveredLocales, localeName, LOCALE_NAMES }
