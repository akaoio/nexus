/**
 * Kernel conformance — ROUTER (KRN-RT).
 * Pins the pure routing core: pattern matching and path processing, fully
 * parameter-driven (no global store reads — the kernel decoupling contract).
 */

import Test, { assert } from "../../src/kernel/Test.js"
import Router from "../../src/kernel/Router.js"

const LOCALES = [{ code: "en" }, { code: "vi" }, { code: "fr" }]
const ROUTES = ["/item/[item]", "/tag/[tag]", "/docs/[...path]", "/files/[[...path]]"]

Test.describe("Kernel — router (KRN-RT)", () => {
    Test.it("KRN-RT01 match extracts dynamic segments", () => {
        assert.deepEqual(Router.match(["item", "abc-123"], "/item/[item]"), { item: "abc-123" })
        assert.equal(Router.match(["about"], "/item/[item]"), null)
    })

    Test.it("KRN-RT02 static parts must match exactly and fully", () => {
        assert.deepEqual(Router.match(["tag", "x"], "/tag/[tag]"), { tag: "x" })
        assert.equal(Router.match(["tag"], "/tag/[tag]"), null) // missing segment
        assert.equal(Router.match(["tag", "x", "extra"], "/tag/[tag]"), null) // leftover segment
    })

    Test.it("KRN-RT03 catch-all requires at least one segment and captures the rest", () => {
        assert.deepEqual(Router.match(["docs", "api", "router"], "/docs/[...path]"), { path: ["api", "router"] })
        assert.equal(Router.match(["docs"], "/docs/[...path]"), null)
    })

    Test.it("KRN-RT04 optional catch-all may be empty", () => {
        assert.deepEqual(Router.match(["files"], "/files/[[...path]]"), { path: [] })
        assert.deepEqual(Router.match(["files", "a", "b"], "/files/[[...path]]"), { path: ["a", "b"] })
    })

    Test.it("KRN-RT05 a catch-all anywhere but last never matches", () => {
        assert.equal(Router.match(["docs", "a", "edit"], "/docs/[...path]/edit"), null)
    })

    Test.it("KRN-RT06 process extracts the locale prefix and matches the route", () => {
        const result = Router.process({ path: "/fr/item/organic-tea", routes: ROUTES, locales: LOCALES })
        assert.equal(result.locale.code, "fr")
        assert.equal(result.route, "/item/[item]")
        assert.deepEqual(result.params, { item: "organic-tea" })
        assert.equal(result.path, "/fr/item/organic-tea/")
    })

    Test.it("KRN-RT07 no locale in path → first configured locale, home route", () => {
        const result = Router.process({ path: "/", routes: ROUTES, locales: LOCALES })
        assert.equal(result.locale.code, "en")
        assert.equal(result.route, "home")
        assert.equal(result.path, "/en/")
    })

    Test.it("KRN-RT08 explicit locale argument wins over the path prefix", () => {
        const result = Router.process({ path: "/fr/tag/sale", routes: ROUTES, locales: LOCALES, locale: "vi" })
        assert.equal(result.locale.code, "vi")
        assert.deepEqual(result.params, { tag: "sale" })
    })

    Test.it("KRN-RT09 search params merge into params; path params take precedence", () => {
        const result = Router.process({
            path: "/en/item/tea?sort=price&item=OVERRIDE&page=2",
            routes: ROUTES,
            locales: LOCALES
        })
        assert.equal(result.params.item, "tea") // path wins
        assert.equal(result.params.sort, "price")
        assert.equal(result.params.page, "2")
    })

    Test.it("KRN-RT10 a trailing file segment is stripped before matching", () => {
        const result = Router.process({ path: "/en/item/tea/index.html", routes: ROUTES, locales: LOCALES })
        assert.equal(result.route, "/item/[item]")
        assert.deepEqual(result.params, { item: "tea" })
    })

    Test.it("KRN-RT11 with no locales configured, the path carries no locale prefix", () => {
        const result = Router.process({ path: "/item/tea", routes: ROUTES })
        assert.equal(result.locale, undefined)
        assert.equal(result.route, "/item/[item]")
        assert.equal(result.path, "/item/tea/")
    })

    Test.it("KRN-RT12 site.locale is the fallback when the path has no prefix", () => {
        const result = Router.process({ path: "/tag/sale", routes: ROUTES, locales: LOCALES, site: { locale: "vi" } })
        assert.equal(result.locale.code, "vi")
        assert.equal(result.path, "/vi/tag/sale/")
    })
})
