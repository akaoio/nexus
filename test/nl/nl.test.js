/**
 * NL→AST conformance (NL-*) — §4.6f. The deterministic rule provider proves
 * the round-trip; translate() is the safety choke point (validated AST,
 * schema-checked fields); and DataPlane.ask runs the whole thing through
 * permission — an LLM shapes the filter but can never widen access.
 */

import Test, { assert } from "../../src/core/Test.js"
import { ruleProvider, embeddingNLProvider, translate } from "../../src/core/NL.js"
import { intentsFor } from "../../src/core/NL/intents.js"
import { hashProvider } from "../../src/core/Semantic.js"
import * as AST from "../../src/core/AST.js"
import { DataPlane } from "../../src/core/Data.js"
import { tableDDL } from "../../src/core/Data/ddl.js"
import { createCompiler } from "../../src/core/Data/kysely.js"
import { schema, field } from "../conformance/model/_helpers.js"
import { doc, leaf } from "../conformance/ast/_helpers.js"

const TASK = schema({
    name: "task",
    fields: [
        field("title", "text", { required: true, label: { en: "Title", vi: "Tiêu đề" } }),
        field("done", "boolean", { label: { en: "Done", vi: "Xong" } }),
        field("priority", "select", { options: ["low", "medium", "high"] }),
        field("points", "integer"),
        field("due", "date"),
        field("status", "select", { options: ["open", "in progress", "closed"] }),
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

    Test.it("NL-01b schema-aware natural reading: a boolean field / select option named in plain words", async () => {
        assert.deepEqual((await ruleProvider("done tasks", { schema: TASK })).root, { field: "done", operator: "eq", value: true })
        assert.deepEqual((await ruleProvider("not done", { schema: TASK })).root, { field: "done", operator: "eq", value: false })
        assert.deepEqual((await ruleProvider("high priority", { schema: TASK })).root, { field: "priority", operator: "eq", value: "high" })
        const both = (await ruleProvider("done high priority tasks", { schema: TASK })).root
        assert.equal(both.op, "and")
        assert.equal(both.children.length, 2)
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

    Test.it("NL-05 field designators are case-insensitive and may be schema labels (any locale)", async () => {
        assert.deepEqual((await ruleProvider("Priority = high", { schema: TASK })).root, { field: "priority", operator: "eq", value: "high" })
        assert.deepEqual((await ruleProvider("DONE = true", { schema: TASK })).root, { field: "done", operator: "eq", value: true })
        assert.deepEqual((await ruleProvider("Title contains ship", { schema: TASK })).root, { field: "title", operator: "like", value: "%ship%" })
        // labels resolve to the real field — English and Vietnamese alike
        assert.deepEqual((await ruleProvider("Tiêu đề contains bánh", { schema: TASK })).root, { field: "title", operator: "like", value: "%bánh%" })
        // translate() sees the RESOLVED field name, so labels pass the vocabulary check
        const document = await translate("Title contains ship", TASK)
        assert.equal(document.root.field, "title")
    })

    Test.it("NL-06 and/or precedence and quoted values: or binds looser; quotes protect connectives", async () => {
        const mixed = (await ruleProvider("done = true and points > 3 or priority = low", { schema: TASK })).root
        assert.equal(mixed.op, "or")
        assert.equal(mixed.children[0].op, "and")
        assert.deepEqual(mixed.children[1], { field: "priority", operator: "eq", value: "low" })
        // a quoted value containing " and " is one value, not two clauses
        const quoted = (await ruleProvider('title ~ "bread and butter"', { schema: TASK })).root
        assert.deepEqual(quoted, { field: "title", operator: "like", value: "%bread and butter%" })
    })

    Test.it("NL-07 date words become $NOW variables on date fields: today / tomorrow / yesterday, before / after", async () => {
        assert.deepEqual((await ruleProvider("due < today", { schema: TASK })).root, { field: "due", operator: "lt", value: "$NOW" })
        assert.deepEqual((await ruleProvider("due before today", { schema: TASK })).root, { field: "due", operator: "lt", value: "$NOW" })
        assert.deepEqual((await ruleProvider("due after tomorrow", { schema: TASK })).root, { field: "due", operator: "gt", value: "$NOW(+1 day)" })
        assert.deepEqual((await ruleProvider("due >= yesterday", { schema: TASK })).root, { field: "due", operator: "gte", value: "$NOW(-1 day)" })
        // the produced document still validates and resolves like any AST
        const document = await translate("due before today", TASK)
        const resolved = AST.resolve(document, { now: "2026-07-17T00:00:00.000Z" })
        assert.equal(resolved.root.value, "2026-07-17T00:00:00.000Z")
    })

    Test.it("NL-08 natural reading understands negation windows, un- prefixes and Vietnamese negations", async () => {
        assert.deepEqual((await ruleProvider("not yet done", { schema: TASK })).root, { field: "done", operator: "eq", value: false })
        assert.deepEqual((await ruleProvider("undone tasks", { schema: TASK })).root, { field: "done", operator: "eq", value: false })
        assert.deepEqual((await ruleProvider("chưa done", { schema: TASK })).root, { field: "done", operator: "eq", value: false })
        assert.deepEqual((await ruleProvider("không done", { schema: TASK })).root, { field: "done", operator: "eq", value: false })
        // a boolean's label counts as naming it — "chưa xong" reads the vi label of done
        assert.deepEqual((await ruleProvider("chưa xong", { schema: TASK })).root, { field: "done", operator: "eq", value: false })
        assert.deepEqual((await ruleProvider("xong", { schema: TASK })).root, { field: "done", operator: "eq", value: true })
    })

    Test.it("NL-09 natural reading matches multi-word select options as phrases", async () => {
        assert.deepEqual((await ruleProvider("in progress", { schema: TASK })).root, { field: "status", operator: "eq", value: "in progress" })
        const both = (await ruleProvider("in progress and high priority", { schema: TASK })).root
        assert.equal(both.op, "and")
        assert.deepEqual(new Set(both.children.map((c) => c.field)), new Set(["status", "priority"]))
    })

    Test.it("NL-10 several options of ONE select named together become an `in` — 'high or medium priority'", async () => {
        assert.deepEqual((await ruleProvider("high or medium priority", { schema: TASK })).root, { field: "priority", operator: "in", value: ["high", "medium"] })
        assert.deepEqual((await ruleProvider("high priority", { schema: TASK })).root, { field: "priority", operator: "eq", value: "high" })
    })

    Test.it("NL-11 the schema-derived intent library + a real embedder translate text the grammar can't", async () => {
        const intents = intentsFor(TASK)
        assert.truthy(intents.length > 10, "the schema generates a non-trivial intent library")
        assert.truthy(intents.every((i) => i.ast.astVersion === 1), "every intent carries a real AST document")
        // retrieval through a REAL (lexical) embedder — the semantic model path
        // is pinned by the gated real-embedding suite and the live server
        const provider = embeddingNLProvider({ examples: intents, embedder: hashProvider(256), threshold: 0.3 })
        const document = await translate("việc chưa xong", TASK, provider)
        assert.deepEqual(document.root, { field: "done", operator: "eq", value: false })
    })

    Test.it("NL-12 the provider seam: schema in as TOOLS, call text out, parsed and choke-pointed", async () => {
        const { llmNLProvider } = await import("../../src/core/NL/llm.js")
        // the generate seam receives the schema AS a tool declaration — never prose
        let seen = null
        const provider = llmNLProvider({
            generate: async ({ tools, user }) => {
                seen = { tools, user }
                return "<start_function_call>call:filter_records{filter:{field:<escape>done<escape>,operator:<escape>eq<escape>,value:false}}<end_function_call>"
            }
        })
        const document = await provider("việc chưa xong", { schema: TASK })
        assert.deepEqual(document, { astVersion: 1, root: { field: "done", operator: "eq", value: false } })
        assert.equal(seen.user, "việc chưa xong")
        assert.equal(seen.tools.length, 1)
        assert.equal(seen.tools[0].function.name, "filter_records")
        await Test.assert.rejects(Promise.resolve().then(() => llmNLProvider({})), "E_NL_GENERATOR")
    })

    Test.it("NL-12a the LLM tier declares the schema AS SCHEMA: filterTool is a complete function declaration", async () => {
        const { filterTool } = await import("../../src/core/NL/llm.js")
        const tool = filterTool(TASK)
        assert.equal(tool.type, "function")
        assert.equal(tool.function.name, "filter_records")
        const params = tool.function.parameters
        assert.deepEqual(params.required, ["filter"])
        const node = params.properties.filter
        assert.deepEqual(node.type, ["object", "null"]) // filter:null ("everything") must be structurally admissible
        // the field vocabulary is an ENUM — the model cannot be offered a field that doesn't exist
        for (const name of ["title", "done", "priority", "points", "due", "status", "secret", "id", "owner", "created_at", "updated_at"])
            assert.truthy(node.properties.field.enum.includes(name), `field enum carries ${name}`)
        assert.truthy(!node.properties.field.enum.includes("ghost"), "no invented fields")
        // the closed operator list, verbatim
        assert.deepEqual(node.properties.operator.enum, ["eq", "ne", "gt", "gte", "lt", "lte", "like", "nlike", "in", "nin", "between", "isnull", "notnull"])
        // groups: op enum + children of the same shape
        assert.deepEqual(node.properties.op.enum, ["and", "or", "not"])
        assert.equal(node.properties.children.type, "array")
        // types, options, labels and date variables ride in descriptions
        const prose = JSON.stringify(tool)
        for (const must of ["low, medium, high", "Tiêu đề", "$NOW", "priority (select)"])
            assert.truthy(prose.includes(must), `declaration carries ${JSON.stringify(must)}`)
    })

    Test.it("NL-12b parseCall reads FunctionGemma call syntax strictly — and feeds the SAME choke point", async () => {
        const { parseCall } = await import("../../src/core/NL/llm.js")
        const wrap = (args) => `<start_function_call>call:filter_records{${args}}<end_function_call>`
        // a leaf: escape-delimited strings, bare keys
        assert.deepEqual(
            parseCall(wrap("filter:{field:<escape>priority<escape>,operator:<escape>eq<escape>,value:<escape>high<escape>}")),
            { astVersion: 1, root: { field: "priority", operator: "eq", value: "high" } })
        // a nested group with an array value and bare literals
        assert.deepEqual(
            parseCall(wrap("filter:{op:<escape>and<escape>,children:[{field:<escape>priority<escape>,operator:<escape>in<escape>,value:[<escape>high<escape>,<escape>low<escape>]},{field:<escape>done<escape>,operator:<escape>eq<escape>,value:false}]}")),
            { astVersion: 1, root: { op: "and", children: [
                { field: "priority", operator: "in", value: ["high", "low"] },
                { field: "done", operator: "eq", value: false }
            ] } })
        // numbers stay numbers; null filter means "everything"
        assert.deepEqual(parseCall(wrap("filter:{field:<escape>points<escape>,operator:<escape>gt<escape>,value:3}")).root.value, 3)
        assert.deepEqual(parseCall(wrap("filter:null")), { astVersion: 1, root: null })
        // strictness: no call, wrong function, broken args, missing filter — all E_NL_LLM
        await Test.assert.rejects(Promise.resolve().then(() => parseCall("I cannot help with that")), "E_NL_LLM")
        await Test.assert.rejects(Promise.resolve().then(() => parseCall("<start_function_call>call:drop_tables{filter:null}<end_function_call>")), "E_NL_LLM")
        await Test.assert.rejects(Promise.resolve().then(() => parseCall(wrap("filter:{field:<escape>done<escape>"))), "E_NL_LLM")
        await Test.assert.rejects(Promise.resolve().then(() => parseCall(wrap("verbose:true"))), "E_NL_LLM")
        // pathological nesting fails the CONTRACT way — E_NL_LLM, never a stack overflow
        await Test.assert.rejects(Promise.resolve().then(() => parseCall(wrap("filter:" + "[".repeat(100000)))), "E_NL_LLM")
        // whatever parses still dies in translate() when it names a ghost field
        const provider = async () => parseCall(wrap("filter:{field:<escape>ghost<escape>,operator:<escape>eq<escape>,value:1}"))
        await Test.assert.rejects(translate("anything", TASK, provider), "E_NL_FIELD")
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
