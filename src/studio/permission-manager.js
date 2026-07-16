/**
 * <nx-permission-manager> — the policy matrix editor (ARCHITECTURE.md §7),
 * and THE FIRST REUSE of <nx-query-builder>: a policy's row-level rule is a
 * Query AST document, so its editor is the same component that edits list
 * filters — one UI, learned once, by construction.
 *
 * `.value` is an array of Permission v1 policy objects — exactly the shape
 * Permission.resolve consumes: { entity, actions, rule, permlevel, ifOwner }
 * plus an optional `roles: [...]` annotation (the assignment hint the auth
 * layer upstream consumes; resolve() itself ignores it, per the spec's
 * assignment-is-upstream rule). Every edit emits "change" { value, valid }.
 *
 * The golden invariant: `valid` ≡ every policy passes validatePolicy — and
 * the bridge clause pins that every validatePolicy-passing policy runs
 * through Permission.resolve WITHOUT throwing. The manager can only produce
 * what the engine accepts.
 */

import { Component } from "../kernel/UI/Component.js"
import { html, render } from "../kernel/UI.js"
import { css } from "../kernel/UI/css.js"
import { ACTIONS } from "../permission/Permission.js"
import * as AST from "../ast/AST.js"
import "./query-builder.js" // registers <nx-query-builder>

const clone = (x) => JSON.parse(JSON.stringify(x))

// ─── pure helpers (pinned in Node) ────────────────────────────────────────────

/** A fresh, harmless policy: read-only on the first entity, unrestricted. */
export function emptyPolicy(schemas) {
    return { entity: schemas?.[0]?.name ?? "entity", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }
}

/**
 * Non-throwing policy validation — the manager's side of the bridge to
 * Permission.resolve (which rejects loudly). When `schemas` is provided the
 * entity must be one of them.
 * @returns {{valid: true} | {valid: false, errors: Array<{code: string}>}}
 */
export function validatePolicy(policy, schemas = null) {
    const errors = []
    if (policy === null || typeof policy !== "object" || Array.isArray(policy))
        return { valid: false, errors: [{ code: "E_POLICY" }] }

    if (typeof policy.entity !== "string" || !policy.entity) errors.push({ code: "E_ENTITY" })
    else if (schemas && !schemas.some((s) => s.name === policy.entity)) errors.push({ code: "E_ENTITY" })

    if (!Array.isArray(policy.actions) || policy.actions.length === 0) errors.push({ code: "E_ACTIONS" })
    else if (!policy.actions.every((a) => ACTIONS.includes(a))) errors.push({ code: "E_ACTIONS" })

    const permlevel = policy.permlevel ?? 0
    if (!Number.isInteger(permlevel) || permlevel < 0 || permlevel > 9) errors.push({ code: "E_PERMLEVEL" })

    if (policy.rule !== null && policy.rule !== undefined && !AST.validate(policy.rule).valid)
        errors.push({ code: "E_RULE" })

    if (policy.ifOwner !== undefined && typeof policy.ifOwner !== "boolean") errors.push({ code: "E_IFOWNER" })

    if (policy.roles !== undefined && (!Array.isArray(policy.roles) || !policy.roles.every((r) => typeof r === "string")))
        errors.push({ code: "E_ROLES" })

    return errors.length ? { valid: false, errors } : { valid: true }
}

/** The whole set at once. */
export const validatePolicies = (policies, schemas = null) =>
    Array.isArray(policies) && policies.every((p) => validatePolicy(p, schemas).valid)

// ─── styling ──────────────────────────────────────────────────────────────────

const STYLE = () => css`
    :host { font-family: system-ui; font-size: 14px; display: block }
    .policy { border: 1px solid #94a3b833; border-left: 3px solid #0ea5e9; border-radius: 6px; padding: 8px; margin: 8px 0 }
    .policy.invalid { border-left-color: #dc2626 }
    .line { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; margin: 4px 0 }
    select, input, button { font: inherit; padding: 2px 6px; border: 1px solid #94a3b8; border-radius: 4px; background: transparent; color: inherit }
    button { cursor: pointer }
    button.remove { border-color: #dc2626; color: #dc2626 }
    label.action, label.flag { display: inline-flex; gap: 3px; align-items: center; cursor: pointer }
    input.permlevel { width: 3.5em } input.roles { width: 12em }
    .rule-slot { margin-top: 6px }
    .muted { color: #64748b }
`

// ─── <nx-permission-manager> ──────────────────────────────────────────────────

export class NxPermissionManager extends Component {
    #policies = []
    #schemas = []
    #expanded = new Set()

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
    }

    set schemas(schemas) {
        this.#schemas = schemas ?? []
        if (this.isConnected) this.mount()
    }

    get schemas() {
        return this.#schemas
    }

    set value(policies) {
        this.#policies = clone(policies ?? [])
        if (this.isConnected) this.mount()
    }

    get value() {
        return clone(this.#policies)
    }

    onconnect() {
        this.mount()
    }

    #emit() {
        this.dispatchEvent(
            new CustomEvent("change", {
                detail: { value: this.value, valid: validatePolicies(this.#policies, this.#schemas) },
                bubbles: true,
                composed: true
            })
        )
    }

    #structural() {
        this.mount()
        this.#emit()
    }

    mount() {
        render(html`
            ${STYLE()}
            <div class="line">
                <button class="add-policy" ${({ element }) =>
                    this.listen(element, "click", () => {
                        this.#policies.push(emptyPolicy(this.#schemas))
                        this.#structural()
                    })}>+ policy</button>
                <span class="muted">${this.#policies.length} policies — additive union (Directus v11 shape)</span>
            </div>
            <div class="policies" ${({ element }) => (this.$policies = element)}></div>
        `, this.shadowRoot)

        this.#policies.forEach((policy, index) => this.$policies.appendChild(this.#card(policy, index)))
    }

    #card(policy, index) {
        const card = document.createElement("div")
        card.className = "policy" + (validatePolicy(policy, this.#schemas).valid ? "" : " invalid")

        // line 1: entity · permlevel · ifOwner · roles · remove
        const line1 = document.createElement("div")
        line1.className = "line"

        const entity = document.createElement("select")
        entity.className = "entity"
        for (const schema of this.#schemas) {
            const option = document.createElement("option")
            option.value = schema.name
            option.textContent = schema.name
            entity.appendChild(option)
        }
        entity.value = policy.entity
        this.listen(entity, "change", () => {
            policy.entity = entity.value
            policy.rule = null // the old rule referenced another entity's fields
            this.#structural()
        })
        line1.appendChild(entity)

        const permlevel = document.createElement("input")
        permlevel.className = "permlevel"
        permlevel.type = "number"
        permlevel.min = 0
        permlevel.max = 9
        permlevel.title = "permlevel"
        permlevel.value = policy.permlevel ?? 0
        this.listen(permlevel, "input", () => {
            policy.permlevel = permlevel.value === "" ? 0 : Number(permlevel.value)
            this.#emit()
        })
        line1.appendChild(permlevel)

        const ifOwner = document.createElement("label")
        ifOwner.className = "flag"
        const ifOwnerBox = document.createElement("input")
        ifOwnerBox.type = "checkbox"
        ifOwnerBox.className = "if-owner"
        ifOwnerBox.checked = policy.ifOwner === true
        this.listen(ifOwnerBox, "change", () => {
            policy.ifOwner = ifOwnerBox.checked
            this.#emit()
        })
        ifOwner.appendChild(ifOwnerBox)
        ifOwner.appendChild(document.createTextNode("if owner"))
        line1.appendChild(ifOwner)

        const roles = document.createElement("input")
        roles.className = "roles"
        roles.placeholder = "roles, comma-separated"
        roles.value = (policy.roles ?? []).join(", ")
        this.listen(roles, "input", () => {
            const list = roles.value.split(",").map((s) => s.trim()).filter((s) => s !== "")
            if (list.length) policy.roles = list
            else delete policy.roles
            this.#emit()
        })
        line1.appendChild(roles)

        const remove = document.createElement("button")
        remove.className = "remove"
        remove.textContent = "×"
        this.listen(remove, "click", () => {
            this.#policies.splice(index, 1)
            this.#expanded.delete(policy)
            this.#structural()
        })
        line1.appendChild(remove)
        card.appendChild(line1)

        // line 2: the seven lifecycle actions
        const line2 = document.createElement("div")
        line2.className = "line actions"
        for (const action of ACTIONS) {
            const label = document.createElement("label")
            label.className = "action"
            const box = document.createElement("input")
            box.type = "checkbox"
            box.dataset.action = action
            box.checked = policy.actions.includes(action)
            this.listen(box, "change", () => {
                policy.actions = ACTIONS.filter((a) => (a === action ? box.checked : policy.actions.includes(a)))
                this.#emit()
            })
            label.appendChild(box)
            label.appendChild(document.createTextNode(action))
            line2.appendChild(label)
        }
        card.appendChild(line2)

        // line 3: the row rule — edited by <nx-query-builder> (THE reuse)
        const line3 = document.createElement("div")
        line3.className = "line"
        const toggle = document.createElement("button")
        toggle.className = "edit-rule"
        toggle.textContent = policy.rule === null || policy.rule === undefined ? "rule: all rows · edit" : "rule: restricted · edit"
        this.listen(toggle, "click", () => {
            if (this.#expanded.has(policy)) this.#expanded.delete(policy)
            else this.#expanded.add(policy)
            this.#structural()
        })
        line3.appendChild(toggle)
        card.appendChild(line3)

        if (this.#expanded.has(policy)) {
            const slot = document.createElement("div")
            slot.className = "rule-slot"
            const builder = document.createElement("nx-query-builder")
            builder.schema = this.#schemas.find((s) => s.name === policy.entity)
            builder.value = policy.rule ?? { astVersion: 1, root: null }
            builder.addEventListener("change", (e) => {
                // The embedded builder's change must not escape as OUR change
                // — the manager re-emits its own shape after absorbing it.
                e.stopPropagation()
                policy.rule = e.detail.value.root === null ? null : e.detail.value
                this.#emit()
            })
            slot.appendChild(builder)
            card.appendChild(slot)
        }

        return card
    }
}

if (typeof customElements !== "undefined") customElements.define("nx-permission-manager", NxPermissionManager)
