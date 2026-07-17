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
 *
 * akao triad: logic here, template in template.js, styles in styles.css.js.
 */

import { Component } from "../../../core/UI/Component.js"
import { render } from "../../../core/UI.js"
import { ACTIONS } from "../../../core/Permission.js"
import { validatePolicy, validatePolicies } from "../../../core/App/policies.js"
import "../query-builder/index.js" // registers <nx-query-builder>
import { managerTemplate } from "./template.js"

// The canonical validator lives in app/Policies.js (shared with the app
// loaders); the manager re-exports it so its public surface is unchanged.
export { validatePolicy, validatePolicies }

const clone = (x) => JSON.parse(JSON.stringify(x))

// ─── pure helpers (pinned in Node) ────────────────────────────────────────────

/** A fresh, harmless policy: read-only on the first entity, unrestricted. */
export function emptyPolicy(schemas) {
    return { entity: schemas?.[0]?.name ?? "entity", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }
}

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
        render(managerTemplate(this, {
            count: this.#policies.length,
            onAddPolicy: () => {
                this.#policies.push(emptyPolicy(this.#schemas))
                this.#structural()
            }
        }), this.shadowRoot)

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
