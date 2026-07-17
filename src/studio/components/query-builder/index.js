/**
 * <nx-query-builder> — the visual editor of Query AST v1 documents
 * (ARCHITECTURE.md §7, the number-one differentiator).
 *
 * A RECURSIVE component: <nx-query-group> renders condition rows and child
 * groups — itself — so unlimited nesting depth falls out of the component
 * structure, exactly as unlimited depth falls out of the AST structure.
 * The builder reads and writes real AST documents: `.value` accepts any
 * valid document and returns one (always a clone); every edit emits a
 * "change" event carrying { value, valid }.
 *
 * One reactivity system (§3): the document is the single source of truth
 * held by the root; structural edits re-render, scalar edits mutate the
 * node in place and emit — no second reactive layer.
 *
 * NOT handling: the UI exposes negation as a toggle on groups. On load the
 * document is normalized — consecutive `not`s fold (not(not(x)) → x) and
 * `not(leaf)` wraps to `not(and(leaf))` — both SEMANTICALLY identical
 * transformations (and-of-one is itself), pinned by predicate-equivalence
 * clauses. Documents without `not` round-trip byte-identically.
 *
 * akao triad: logic here, DOM shapes in template.js, styles in styles.css.js.
 * The pure helpers are exported and pinned in Node; the DOM behavior is
 * pinned in the browser conformance run.
 */

import { Component } from "../../../kernel/UI/Component.js"
import { render } from "../../../kernel/UI.js"
import * as AST from "../../../ast/AST.js"
import { conditionTemplate, groupTemplate, emptyTemplate, rootTemplate } from "./template.js"

const clone = (x) => JSON.parse(JSON.stringify(x))
const matchAll = () => ({ astVersion: 1, root: null })

/** System fields every entity carries (mirrors Model.SYSTEM_FIELDS + types). */
export const SYSTEM_FIELD_DEFS = Object.freeze([
    { name: "id", type: "text" },
    { name: "owner", type: "text" },
    { name: "created_at", type: "datetime" },
    { name: "updated_at", type: "datetime" }
])

/** Operators offered per field type — every entry is in AST.OPERATORS. */
export const OPERATORS_BY_TYPE = Object.freeze({
    text: ["eq", "ne", "like", "nlike", "in", "nin", "isnull", "notnull"],
    file: ["eq", "ne", "like", "nlike", "in", "nin", "isnull", "notnull"],
    link: ["eq", "ne", "in", "nin", "isnull", "notnull"],
    select: ["eq", "ne", "in", "nin", "isnull", "notnull"],
    integer: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "nin", "isnull", "notnull"],
    number: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "in", "nin", "isnull", "notnull"],
    date: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "isnull", "notnull"],
    datetime: ["eq", "ne", "gt", "gte", "lt", "lte", "between", "isnull", "notnull"],
    boolean: ["eq", "ne", "isnull", "notnull"]
})

const NUMERIC = new Set(["integer", "number"])
const NO_VALUE = new Set(["isnull", "notnull"])

/** The editable field list for a schema: declared (non-table) + system. */
export function fieldDefs(schema) {
    const declared = (schema?.fields ?? []).filter((f) => f.type !== "table")
    return [...declared, ...SYSTEM_FIELD_DEFS]
}

/**
 * A fresh, valid leaf for the schema's first field. Frappe-informed: dates
 * open as `between`, and text/number conditions start EMPTY — pending, see
 * `activeFilter` — so adding a condition never instantly blanks the list.
 * (Text keeps `eq` as its first operator — pinned by NXQ-10.)
 */
export function emptyCondition(schema) {
    const field = fieldDefs(schema)[0]
    if (field.type === "date" || field.type === "datetime")
        return { field: field.name, operator: "between", value: ["", ""] }
    if (NUMERIC.has(field.type)) return { field: field.name, operator: "eq", value: "" }
    return { field: field.name, operator: "eq", value: defaultValue(field) }
}

export function defaultValue(field) {
    if (NUMERIC.has(field.type)) return 0
    if (field.type === "boolean") return true
    if (field.type === "select") return field.options?.[0] ?? ""
    return ""
}

/**
 * The QUERYABLE reading of an edited tree (Frappe's rule, recursive): a
 * condition with no value yet is PENDING and simply does not constrain the
 * query — never "matches nothing". `like` values without a wildcard mean
 * "contains" and wrap as %value%; `between` waits for both bounds; `in`/`nin`
 * for at least one entry. Groups prune bottom-up; everything-pending → null.
 */
export function activeFilter(node) {
    if (!node) return null
    if (node.field) {
        if (NO_VALUE.has(node.operator)) return { ...node }
        const value = node.value
        if (value === "" || value === null || value === undefined) return null
        if (node.operator === "between")
            return Array.isArray(value) && value.length === 2 && value.every((v) => v !== "" && v !== null) ? { ...node } : null
        if (node.operator === "in" || node.operator === "nin") {
            const entries = (Array.isArray(value) ? value : [value]).filter((v) => v !== "" && v !== null)
            return entries.length ? { ...node, value: entries } : null
        }
        if ((node.operator === "like" || node.operator === "nlike") && typeof value === "string" && !value.includes("%"))
            return { ...node, value: `%${value}%` }
        return { ...node }
    }
    const children = node.children.map(activeFilter).filter(Boolean)
    if (node.op === "not") return children.length ? { op: "not", children: [children[0]] } : null
    return children.length ? { op: node.op, children } : null
}

/**
 * Normalize for editing: fold consecutive nots, wrap not(leaf) as
 * not(and(leaf)). Semantically identity; structurally canonical.
 */
export function normalize(node) {
    if (!node || node.field) return node
    if (node.op === "not") {
        let negated = true
        let inner = node.children[0]
        while (inner && inner.op === "not") {
            negated = !negated
            inner = inner.children[0]
        }
        inner = normalize(inner)
        // The wrap exists only for the UI: a displayed NOT needs a group
        // child. When the negations fold away entirely, keep the node bare.
        if (negated && inner?.field) inner = { op: "and", children: [inner] }
        return negated ? { op: "not", children: [inner] } : inner
    }
    return { op: node.op, children: node.children.map(normalize) }
}

/** Remove empty groups bottom-up (and/or need ≥1 child); empty root → null. */
export function prune(node) {
    if (!node || node.field) return node
    const children = node.children.map(prune).filter(Boolean)
    if (node.op === "not") return children.length ? { op: "not", children: [children[0]] } : null
    if (!children.length) return null
    return { op: node.op, children }
}

// ─── <nx-query-condition> — a leaf row ────────────────────────────────────────

export class NxQueryCondition extends Component {
    constructor() {
        super()
        this.attachShadow({ mode: "open" })
    }

    onconnect() {
        this.mount()
    }

    #fieldDef() {
        return fieldDefs(this.schema).find((f) => f.name === this.node.field) ?? fieldDefs(this.schema)[0]
    }

    #parse(text) {
        const type = this.#fieldDef().type
        if (NUMERIC.has(type)) {
            const n = Number(text)
            return Number.isNaN(n) ? 0 : type === "integer" ? Math.trunc(n) : n
        }
        return text
    }

    mount() {
        const { node } = this
        const field = this.#fieldDef()
        const operators = OPERATORS_BY_TYPE[field.type] ?? OPERATORS_BY_TYPE.text
        if (!operators.includes(node.operator)) {
            node.operator = operators[0]
            node.value = defaultValue(field)
        }

        const remount = () => {
            this.mount()
            this.hooks.edited()
        }

        render(conditionTemplate(this, {
            fields: fieldDefs(this.schema),
            operators,
            node,
            onField: (name) => {
                node.field = name
                const next = this.#fieldDef()
                node.operator = (OPERATORS_BY_TYPE[next.type] ?? [])[0] ?? "eq"
                if (NO_VALUE.has(node.operator)) delete node.value
                else node.value = defaultValue(next)
                remount()
            },
            onOperator: (op) => {
                node.operator = op
                if (NO_VALUE.has(node.operator)) delete node.value
                else if (node.operator === "between") node.value = [defaultValue(field), defaultValue(field)]
                else if (node.operator === "in" || node.operator === "nin") node.value = [defaultValue(field)]
                else node.value = defaultValue(field)
                remount()
            },
            onRemove: () => {
                this.locator.container.splice(this.locator.index, 1)
                this.hooks.structural()
            },
            mountValue: (slot) => this.#mountValue(slot)
        }), this.shadowRoot)
    }

    #mountValue(slot) {
        const { node } = this
        const field = this.#fieldDef()
        if (NO_VALUE.has(node.operator)) return

        const input = (value, onchange, type = "text") => {
            const el = document.createElement("input")
            el.className = "value"
            el.type = type
            el.value = value
            this.listen(el, "input", () => {
                onchange(el)
                this.hooks.edited()
            })
            slot.appendChild(el)
            return el
        }

        if (node.operator === "between") {
            if (!Array.isArray(node.value) || node.value.length !== 2)
                node.value = [defaultValue(field), defaultValue(field)]
            input(node.value[0], (el) => (node.value[0] = this.#parse(el.value)), NUMERIC.has(field.type) ? "number" : "text")
            input(node.value[1], (el) => (node.value[1] = this.#parse(el.value)), NUMERIC.has(field.type) ? "number" : "text")
            return
        }
        if (node.operator === "in" || node.operator === "nin") {
            if (!Array.isArray(node.value)) node.value = [node.value ?? defaultValue(field)]
            input(node.value.join(", "), (el) => {
                const parts = el.value.split(",").map((s) => s.trim()).filter((s) => s !== "")
                node.value = parts.length ? parts.map((p) => this.#parse(p)) : [defaultValue(field)]
            })
            return
        }
        if (field.type === "boolean") {
            const el = document.createElement("select")
            el.className = "value"
            for (const v of ["true", "false"]) {
                const option = document.createElement("option")
                option.value = v
                option.textContent = v
                el.appendChild(option)
            }
            el.value = String(node.value === true)
            this.listen(el, "change", () => {
                node.value = el.value === "true"
                this.hooks.edited()
            })
            slot.appendChild(el)
            return
        }
        if (field.type === "select") {
            const el = document.createElement("select")
            el.className = "value"
            for (const option of field.options ?? []) {
                const opt = document.createElement("option")
                opt.value = option
                opt.textContent = option
                el.appendChild(opt)
            }
            el.value = typeof node.value === "string" ? node.value : field.options?.[0] ?? ""
            this.listen(el, "change", () => {
                node.value = el.value
                this.hooks.edited()
            })
            slot.appendChild(el)
            return
        }
        input(node.value ?? "", (el) => (node.value = this.#parse(el.value)), NUMERIC.has(field.type) ? "number" : "text")
    }
}

// ─── <nx-query-group> — recursive: renders conditions and ITSELF ─────────────

export class NxQueryGroup extends Component {
    constructor() {
        super()
        this.attachShadow({ mode: "open" })
    }

    onconnect() {
        this.mount()
    }

    mount() {
        const { node } = this
        render(groupTemplate(this, {
            node,
            negated: this.negated,
            onOp: (op) => {
                node.op = op
                this.hooks.edited()
            },
            onNegate: (checked) => this.hooks.negate(this.locator, checked),
            onAddCondition: () => {
                node.children.push(emptyCondition(this.schema))
                this.hooks.structural()
            },
            onAddGroup: () => {
                node.children.push({ op: "and", children: [emptyCondition(this.schema)] })
                this.hooks.structural()
            },
            onRemove: () => {
                if (this.locator.root) this.hooks.replaceRoot(null)
                else {
                    this.locator.container.splice(this.locator.index, 1)
                    this.hooks.structural()
                }
            }
        }), this.shadowRoot)

        node.children.forEach((child, index) => {
            const locator = { container: node.children, index }
            if (child.field) {
                const row = document.createElement("nx-query-condition")
                row.node = child
                row.schema = this.schema
                row.hooks = this.hooks
                row.locator = locator
                this.$children.appendChild(row)
            } else {
                const negated = child.op === "not"
                const group = document.createElement("nx-query-group")
                group.node = negated ? child.children[0] : child
                group.negated = negated
                group.schema = this.schema
                group.hooks = this.hooks
                group.locator = locator
                this.$children.appendChild(group)
            }
        })
    }
}

// ─── <nx-query-builder> — the root: owns the document ────────────────────────

export class NxQueryBuilder extends Component {
    #doc = matchAll()
    #schema = null

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
        this.hooks = {
            structural: () => {
                this.#doc.root = prune(this.#doc.root)
                this.mount()
                this.#emit()
            },
            edited: () => this.#emit(),
            negate: (locator, on) => {
                if (locator.root) {
                    const current = this.#doc.root
                    this.#doc.root = on ? { op: "not", children: [current] } : current.children[0]
                } else {
                    const current = locator.container[locator.index]
                    locator.container[locator.index] = on ? { op: "not", children: [current] } : current.children[0]
                }
                this.hooks.structural()
            },
            replaceRoot: (node) => {
                this.#doc.root = node
                this.hooks.structural()
            }
        }
    }

    get value() {
        return clone(this.#doc)
    }

    set value(doc) {
        this.#doc = clone(doc ?? matchAll())
        this.#doc.root = normalize(this.#doc.root)
        if (this.isConnected) this.mount()
    }

    get schema() {
        return this.#schema
    }

    set schema(schema) {
        this.#schema = schema
        if (this.isConnected) this.mount()
    }

    onconnect() {
        this.mount()
    }

    #emit() {
        this.dispatchEvent(
            new CustomEvent("change", {
                detail: { value: this.value, valid: AST.validate(this.#doc).valid },
                bubbles: true,
                composed: true
            })
        )
    }

    mount() {
        const root = this.#doc.root
        if (root === null) {
            render(emptyTemplate(this, {
                onAdd: () => {
                    this.#doc.root = { op: "and", children: [emptyCondition(this.#schema)] }
                    this.mount()
                    this.#emit()
                }
            }), this.shadowRoot)
            return
        }

        render(rootTemplate(this), this.shadowRoot)
        const negated = root.op === "not"
        const group = document.createElement("nx-query-group")
        group.node = negated ? root.children[0] : root
        group.negated = negated
        group.schema = this.#schema
        group.hooks = this.hooks
        group.locator = { root: true }
        this.$root.appendChild(group)
    }
}

if (typeof customElements !== "undefined") {
    customElements.define("nx-query-condition", NxQueryCondition)
    customElements.define("nx-query-group", NxQueryGroup)
    customElements.define("nx-query-builder", NxQueryBuilder)
}
