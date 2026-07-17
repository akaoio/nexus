/**
 * i18n conformance (I18N-*) — the akao translation-memory format made real
 * (ARCHITECTURE.md §5.1). One file per key, all locales inside; a zero-dep
 * flat-YAML reader; `t()` with a fallback chain; and a completeness guard so a
 * shipped UI string is never missing its core locales.
 */

import { fileURLToPath } from "url"
import Test, { assert } from "../../src/kernel/Test.js"
import { parseFlatYaml, loadDictionary, mergeDictionaries, t, translator, coveredLocales, localeName } from "../../src/i18n/i18n.js"

const DICT_DIR = fileURLToPath(new URL("../../src/i18n/dict", import.meta.url))

Test.describe("i18n — translation memory (I18N)", () => {
    Test.it("I18N-01 parseFlatYaml reads key:value, unicode and quotes; ignores comments/blanks", () => {
        const parsed = parseFlatYaml(`# a comment\nen: Save\nvi: Lưu\nzh: 保存\n\nquoted: "  spaced  "\nurl: https://x.io/a\n`)
        assert.equal(parsed.en, "Save")
        assert.equal(parsed.vi, "Lưu")
        assert.equal(parsed.zh, "保存")
        assert.equal(parsed.quoted, "  spaced  ") // quotes preserve inner whitespace
        assert.equal(parsed.url, "https://x.io/a") // only the first colon splits
        assert.equal("# a comment" in parsed, false)
    })

    Test.it("I18N-02 loadDictionary reads <key>.yaml files and the locales registry", () => {
        const { dict, locales } = loadDictionary(DICT_DIR)
        assert.truthy(dict.save, "save.yaml is a key")
        assert.equal(dict.save.en, "Save")
        assert.equal(dict.save.vi, "Lưu")
        assert.equal(locales.vi, "Tiếng Việt") // locales.yaml → registry, not a key
        assert.equal("locales" in dict, false)
    })

    Test.it("I18N-03 t() falls back locale → en → fallback → key, never throws", () => {
        const dict = { save: { en: "Save", vi: "Lưu" } }
        assert.equal(t(dict, "save", "vi"), "Lưu")
        assert.equal(t(dict, "save", "de"), "Save") // missing locale → en
        assert.equal(t(dict, "missing", "vi", "—"), "—") // missing key → fallback
        assert.equal(t(dict, "missing", "vi"), "missing") // no fallback → the key
        const _ = translator(dict, "vi")
        assert.equal(_("save"), "Lưu")
    })

    Test.it("I18N-04 COMPLETENESS: every shipped Studio string covers en + vi", () => {
        const { dict } = loadDictionary(DICT_DIR)
        const keys = Object.keys(dict)
        assert.truthy(keys.length >= 15, "the starter dictionary is non-trivial")
        for (const key of keys) {
            assert.truthy(dict[key].en, `i18n/${key}.yaml is missing en`)
            assert.truthy(dict[key].vi, `i18n/${key}.yaml is missing vi`)
        }
    })

    Test.it("I18N-05 coveredLocales + localeName + merge", () => {
        const { dict } = loadDictionary(DICT_DIR)
        const locales = coveredLocales(dict)
        for (const code of ["en", "vi", "fr", "ja", "zh"]) assert.truthy(locales.includes(code), `dictionary covers ${code}`)
        assert.equal(localeName("vi"), "Tiếng Việt")
        assert.equal(localeName("xx"), "xx") // unknown → the code itself
        const merged = mergeDictionaries({ a: { en: "A" } }, { a: { vi: "Ă" }, b: { en: "B" } })
        assert.equal(merged.a.en, "A")
        assert.equal(merged.a.vi, "Ă")
        assert.equal(merged.b.en, "B")
    })
})
