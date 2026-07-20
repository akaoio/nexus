/**
 * studioRouteMatches — direct unit clauses (carry-over from Task 6's review).
 *
 * The function is a SHARED primitive: both `nexus dev` (src/cli/commands/dev.js)
 * and `nexus start` (src/cli/commands/start.js) ask it "is this path a Studio
 * page", but until now it had no direct test of its own — only whatever an
 * HTTP-level dev/start test happened to exercise. These clauses pin its
 * behavior as a PURE function, passing `schemas`/`locales` explicitly rather
 * than booting a server.
 */

import Test, { assert } from "../../src/core/Test.js"
import { studioRouteMatches } from "../../src/studio/routes.js"

Test.describe("Studio route table — studioRouteMatches (ROUTES)", () => {
    Test.it("an entity route matches against a provided schema; an unknown entity does not", () => {
        assert.equal(studioRouteMatches("/entity/task", { schemas: [{ name: "task" }] }), true, "a real entity name matches")
        assert.equal(studioRouteMatches("/entity/ghost", { schemas: [{ name: "task" }] }), false, "an entity name absent from the schema list never matches")
    })

    Test.it("a settings feature matches; an unknown feature does not", () => {
        assert.equal(studioRouteMatches("/settings/ai"), true, "ai is a declared STUDIO_SETTINGS feature")
        assert.equal(studioRouteMatches("/settings/bogus"), false, "an undeclared settings feature never matches")
    })

    Test.it("a non-\"users\" view matches (roles, jobs)", () => {
        assert.equal(studioRouteMatches("/roles"), true)
        assert.equal(studioRouteMatches("/jobs"), true)
    })

    Test.it("an UNKNOWN view does not match", () => {
        assert.equal(studioRouteMatches("/nope"), false)
    })

    Test.it("a locale-prefixed path matches after the locale prefix is stripped", () => {
        assert.equal(studioRouteMatches("/vi/users", { locales: ["vi", "en"] }), true)
    })

    Test.it("the dotpath guard: a path containing /. never matches", () => {
        assert.equal(studioRouteMatches("/foo/.bar"), false)
        assert.equal(studioRouteMatches("/.git"), false)
    })

    Test.it("a file-looking path never matches", () => {
        assert.equal(studioRouteMatches("/app.js"), false)
    })
})
