/**
 * NL→AST conformance (NL-*) — §4.6f. The deterministic rule provider proves
 * the round-trip; translate() is the safety choke point (validated AST,
 * schema-checked fields); and DataPlane.ask runs the whole thing through
 * permission — an LLM shapes the filter but can never widen access.
 */

import Test, { assert } from "../../src/kernel/Test.js"
import { ruleProvider, translate } from "../../src/nl/nl.js"
import * as AST from "../../src/ast/AST.js"
import { DataPlane } from "../../src/data/DataPlane.js"
import { tableDDL } from "../../src/data/ddl.js"
import { createCompiler } from "../../src/data/kysely.js"
import { schema, field } from "../conformance/model/_helpers.js"
import { doc, leaf } from "../conformance/ast/_helpers.js"

const TASK = schema({
    name: "task",
    fields: [
        field("title", "text", { required: true }),
        field("done", "boolean"),
        field("priority", "select", { options: ["low", "medium", "high"] }),
        field("points", "integer"),
        field("secret", "text", { permlevel: 2 })
    ]
})

Test.describe("NL→AST (NL-*)", () => {
    Test.it("NL-01 the rule provider parses clauses, operators and connectives into a valid AST", async () => {
        assert.deepEqual((await ruleProvider("", { schema: TASK })).root, null)
        const single = await ruleProvider("priority = high", { schema: TASK })
        assert.deepEqual(single.root, { field: "priority", operator: "eq", value: "high" })
        const compound = await ruleProvider("priority = high and points > 3", { schema: TASK })
        assert.equal(compound.root.op, "and")
        assert.deepEqual(compound.root.children[1], { field: "points", operator: "gt", value: 3 })
        const ored = await ruleProvider("done = true or points < 2", { schema: TASK })
        assert.equal(ored.root.op, "or")
        assert.equal(ored.root.children[0].value, true) // boolean coerced
        const contains = await ruleProvider("title contains ship", { schema: TASK })
        assert.deepEqual(contains.root, { field: "title", operator: "like", value: "%ship%" })
        const list = await ruleProvider("priority in [low,high]", { schema: TASK })
        assert.deepEqual(list.root, { field: "priority", operator: "in", value: ["low", "high"] })
    })

    Test.it("NL-02 translate validates the AST and the field vocabulary — loudly", async () => {
        const document = await translate("points >= 5", TASK)
        assert.equal(AST.validate(document).valid, true)
        await Test.assert.rejects(translate("ghostfield = 1", TASK), "E_NL_FIELD")
        await Test.assert.rejects(translate("nooperatorjustwords", TASK), "E_NL_PARSE")
        // a provider returning a malformed AST is rejected as E_NL_AST
        const badProvider = async () => ({ astVersion: 1, root: { op: "xor", children: [] } })
        await Test.assert.rejects(translate("anything", TASK, badProvider), "E_NL_AST")
    })

    Test.it("NL-03 a custom provider (the LLM seam) plugs in with the same signature", async () => {
        const cannedLLM = async (query, { schema }) => {
            assert.equal(schema.name, "task") // the provider receives schema context
            return doc(leaf("done", "eq", false))
        }
        const document = await translate("show me open tasks", TASK, cannedLLM)
        assert.deepEqual(document.root, { field: "done", operator: "eq", value: false })
    })

    Test.it("NL-04 SECURITY: DataPlane.ask runs through permission — NL cannot widen access", async () => {
        const { DatabaseSync } = await import("node:sqlite")
        const db = new DatabaseSync(":memory:")
        const kysely = createCompiler("sqlite")
        for (const b of tableDDL(kysely, TASK)) db.exec(b.compile().sql)
        const executor = { run: (s, p = []) => void db.prepare(s).run(...p), all: (s, p = []) => db.prepare(s).all(...p) }
        const plane = new DataPlane({ executor, schemas: [TASK], dialect: "sqlite" })
        const policy = (over = {}) => ({ entity: "task", actions: ["read", "create"], rule: null, permlevel: 0, ifOwner: false, ...over })
        const admin = { user: "u1", roles: [], policies: [policy()], shares: [] }

        await plane.create("task", { title: "alpha", priority: "high", points: 8 }, admin)
        await plane.create("task", { title: "beta", priority: "low", points: 2 }, admin)

        const { filter, rows } = await plane.ask("task", "priority = high", admin)
        assert.equal(AST.validate(filter).valid, true)
        assert.deepEqual(rows.map((r) => r.title), ["alpha"])

        // permission narrows an NL query just like any other — a policy limited
        // to low-priority rows cannot be widened by asking for high ones
        const scoped = { user: "u2", roles: [], policies: [policy({ rule: doc(leaf("priority", "eq", "low")) })], shares: [] }
        assert.deepEqual((await plane.ask("task", "priority = high", scoped)).rows, [])

        // a permlevel-gated field is never in the returned rows
        const visible = await plane.ask("task", "title contains alpha", admin)
        assert.falsy("secret" in (visible.rows[0] ?? {}), "secret is above permlevel 0 — never selected")

        // and it cannot be used as a filter oracle either (SEC-08)
        await Test.assert.rejects(plane.ask("task", "secret = classified", admin), "E_FIELD_FORBIDDEN")
    })
})
