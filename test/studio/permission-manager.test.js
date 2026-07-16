/**
 * Studio conformance — <nx-permission-manager> (NXP-*).
 *
 * The policy editor and THE FIRST REUSE of <nx-query-builder> (a row rule
 * IS a Query AST document). Node pins the pure validator and its BRIDGE to
 * Permission.resolve — whatever the manager calls valid, the engine accepts
 * without throwing. The browser pins the matrix UI and the full loop:
 * a rule built through the embedded query builder actually filters rows.
 */

import Test, { assert } from "../../src/kernel/Test.js"
import * as Permission from "../../src/permission/Permission.js"
import * as AST from "../../src/ast/AST.js"
import {
    emptyPolicy,
    validatePolicy,
    validatePolicies,
    NxPermissionManager
} from "../../src/studio/permission-manager.js"
import { doc, leaf, ROWS, filter } from "../conformance/ast/_helpers.js"
import { schema, field } from "../conformance/model/_helpers.js"

const SCHEMAS = [
    schema({ name: "customer", fields: [field("tier", "select", { options: ["bronze", "silver", "gold"] }), field("age", "integer")] }),
    schema({ name: "invoice", fields: [field("total", "number")] })
]

const CTX = { entity: "customer", action: "read", user: "u1", roles: [] }

Test.describe("Studio — permission-manager helpers (NXP)", () => {
    Test.it("NXP-01 validatePolicy accepts the pinned shape and rejects each corruption with a code", () => {
        assert.equal(validatePolicy(emptyPolicy(SCHEMAS), SCHEMAS).valid, true)
        const bad = (patch, code) => {
            const result = validatePolicy({ ...emptyPolicy(SCHEMAS), ...patch }, SCHEMAS)
            assert.equal(result.valid, false)
            assert.truthy(result.errors.some((e) => e.code === code), `${code}: ${JSON.stringify(result.errors)}`)
        }
        bad({ entity: "ghost" }, "E_ENTITY")
        bad({ actions: [] }, "E_ACTIONS")
        bad({ actions: ["publish"] }, "E_ACTIONS")
        bad({ permlevel: 10 }, "E_PERMLEVEL")
        bad({ rule: { astVersion: 1, root: { op: "xor", children: [] } } }, "E_RULE")
        bad({ ifOwner: "yes" }, "E_IFOWNER")
        bad({ roles: [1] }, "E_ROLES")
        assert.equal(validatePolicy(null).valid, false)
    })

    Test.it("NXP-02 THE BRIDGE: every validator-passing policy runs through Permission.resolve without throwing", () => {
        const candidates = [
            emptyPolicy(SCHEMAS),
            { ...emptyPolicy(SCHEMAS), rule: doc(leaf("tier", "eq", "gold")) },
            { ...emptyPolicy(SCHEMAS), ifOwner: true, permlevel: 9, actions: ["read", "write", "delete"] },
            { ...emptyPolicy(SCHEMAS), roles: ["sales", "admin"], rule: doc(leaf("owner", "eq", "$CURRENT_USER")) }
        ]
        for (const policy of candidates) {
            assert.equal(validatePolicy(policy, SCHEMAS).valid, true)
            const result = Permission.resolve([policy], CTX) // must not throw
            assert.equal(typeof result.allowed, "boolean")
        }
        // and what the validator rejects, the engine rejects loudly too
        assert.throws(() => Permission.resolve([{ ...emptyPolicy(SCHEMAS), actions: ["publish"] }], CTX), "E_UNKNOWN_ACTION")
        assert.throws(() => Permission.resolve([{ ...emptyPolicy(SCHEMAS), permlevel: 10 }], CTX), "E_PERMLEVEL")
    })

    Test.it("NXP-03 emptyPolicy grants read-only, unrestricted, on the first entity", () => {
        const policy = emptyPolicy(SCHEMAS)
        assert.deepEqual(policy, { entity: "customer", actions: ["read"], rule: null, permlevel: 0, ifOwner: false })
        const read = Permission.resolve([policy], CTX)
        assert.equal(read.allowed, true)
        assert.equal(read.filter, null)
        assert.equal(Permission.resolve([policy], { ...CTX, action: "write" }).allowed, false)
    })

    Test.it("NXP-04 the module imports in Node — class defined, registration browser-only", () => {
        assert.equal(typeof NxPermissionManager, "function")
        assert.equal(validatePolicies([emptyPolicy(SCHEMAS)], SCHEMAS), true)
        assert.equal(validatePolicies([emptyPolicy(SCHEMAS), { bad: true }], SCHEMAS), false)
    })
})

// ─── Browser: the matrix + the reuse ─────────────────────────────────────────

function mountManager(policies) {
    const manager = document.createElement("nx-permission-manager")
    manager.schemas = SCHEMAS
    if (policies) manager.value = policies
    let last = null
    manager.addEventListener("change", (e) => (last = e.detail))
    document.body.appendChild(manager)
    return { manager, lastChange: () => last }
}

const cards = (manager) => [...manager.shadowRoot.querySelectorAll(".policy")]

Test.describe("Studio — <nx-permission-manager> (NXP, browser)", () => {
    Test.it("NXP-10 mounts policies and round-trips byte-identically", () => {
        const policies = [
            { entity: "customer", actions: ["read", "write"], rule: doc(leaf("tier", "eq", "gold")), permlevel: 0, ifOwner: false, roles: ["sales"] },
            { entity: "invoice", actions: ["read"], rule: null, permlevel: 2, ifOwner: true }
        ]
        const { manager } = mountManager(policies)
        assert.equal(cards(manager).length, 2)
        assert.deepEqual(manager.value, policies)
        manager.remove()
    })

    Test.it("NXP-11 add and remove policies through the matrix", () => {
        const { manager, lastChange } = mountManager([])
        manager.shadowRoot.querySelector(".add-policy").click()
        assert.equal(lastChange().valid, true)
        assert.deepEqual(lastChange().value[0], emptyPolicy(SCHEMAS))
        cards(manager)[0].querySelector(".remove").click()
        assert.deepEqual(lastChange().value, [])
        manager.remove()
    })

    Test.it("NXP-12 action checkboxes edit the lifecycle set; empty actions are flagged invalid", () => {
        const { manager, lastChange } = mountManager([emptyPolicy(SCHEMAS)])
        const box = (action) => cards(manager)[0].querySelector(`[data-action="${action}"]`)
        box("write").checked = true
        box("write").dispatchEvent(new Event("change"))
        assert.deepEqual(lastChange().value[0].actions, ["read", "write"])
        box("read").checked = false
        box("read").dispatchEvent(new Event("change"))
        box("write").checked = false
        box("write").dispatchEvent(new Event("change"))
        assert.equal(lastChange().valid, false) // empty actions
        assert.equal(validatePolicies(lastChange().value, SCHEMAS), false) // flag ≡ validator
        manager.remove()
    })

    Test.it("NXP-13 THE REUSE: the row rule is edited by an embedded nx-query-builder", () => {
        const { manager, lastChange } = mountManager([emptyPolicy(SCHEMAS)])
        cards(manager)[0].querySelector(".edit-rule").click()
        const builder = cards(manager)[0].querySelector("nx-query-builder")
        assert.truthy(builder, "the rule editor IS nx-query-builder")
        assert.equal(builder.schema.name, "customer", "the builder targets the policy's entity")
        // build a rule through the builder itself
        builder.shadowRoot.querySelector(".add-condition").click()
        const rule = lastChange().value[0].rule
        assert.equal(rule.astVersion, 1)
        assert.equal(rule.root.op, "and")
        assert.equal(lastChange().valid, true)
        manager.remove()
    })

    Test.it("NXP-14 permlevel, ifOwner and roles edit through the card", () => {
        const { manager, lastChange } = mountManager([emptyPolicy(SCHEMAS)])
        const card = cards(manager)[0]
        const permlevel = card.querySelector(".permlevel")
        permlevel.value = "2"
        permlevel.dispatchEvent(new Event("input"))
        const owner = card.querySelector(".if-owner")
        owner.checked = true
        owner.dispatchEvent(new Event("change"))
        const roles = card.querySelector(".roles")
        roles.value = "sales, admin"
        roles.dispatchEvent(new Event("input"))
        const policy = lastChange().value[0]
        assert.equal(policy.permlevel, 2)
        assert.equal(policy.ifOwner, true)
        assert.deepEqual(policy.roles, ["sales", "admin"])
        assert.equal(lastChange().valid, true)
        manager.remove()
    })

    Test.it("NXP-15 switching entity retargets the rule builder and clears the stale rule", () => {
        const withRule = { ...emptyPolicy(SCHEMAS), rule: doc(leaf("tier", "eq", "gold")) }
        const { manager, lastChange } = mountManager([withRule])
        const entity = cards(manager)[0].querySelector(".entity")
        entity.value = "invoice"
        entity.dispatchEvent(new Event("change"))
        assert.equal(lastChange().value[0].entity, "invoice")
        assert.equal(lastChange().value[0].rule, null, "a rule over another entity's fields must not survive")
        cards(manager)[0].querySelector(".edit-rule").click()
        assert.equal(cards(manager)[0].querySelector("nx-query-builder").schema.name, "invoice")
        manager.remove()
    })

    Test.it("NXP-16 END TO END: a rule built in the UI drives Permission.resolve and filters real rows", () => {
        const { manager, lastChange } = mountManager([emptyPolicy(SCHEMAS)])
        cards(manager)[0].querySelector(".edit-rule").click()
        const builder = cards(manager)[0].querySelector("nx-query-builder")
        builder.value = { astVersion: 1, root: { field: "tier", operator: "eq", value: "gold" } }
        builder.dispatchEvent(new CustomEvent("change", { detail: { value: builder.value, valid: true } }))

        const policies = lastChange().value
        assert.equal(validatePolicies(policies, SCHEMAS), true)
        const { allowed, filter: permFilter } = Permission.resolve(policies, { entity: "customer", action: "read", user: "u1", roles: [] })
        assert.equal(allowed, true)
        const ids = filter(AST.predicate(permFilter), ROWS).map((r) => r.id)
        assert.deepEqual(ids, [1, 5]) // exactly the gold rows
        manager.remove()
    })
}, { browser: true })
