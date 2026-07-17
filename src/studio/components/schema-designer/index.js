/**
 * <nx-schema-designer> — visual entity design with LIVE change
 * classification (ARCHITECTURE.md §7 + §4.4), and THE SECOND REUSE:
 * the editor inside is <nx-form-builder>.
 *
 * The designer holds a BASELINE (the deployed schema) and lets you edit a
 * working copy. On every edit, Model.diff classifies each change live —
 * additive (green: hot-applicable) or structural (red: needs a migration) —
 * and when structural, the designer produces a REAL migration document via
 * migrationPlan, including the human rename declaration: for every removed
 * field it offers same-type added fields as rename targets (the MS-D06
 * disambiguation — a rename preserves data, drop+add loses it; only a
 * person knows which was meant, and only same-type targets make sense).
 *
 * The output contract, pinned end-to-end: the migration document the
 * designer emits is DIRECTLY consumable by applyMigration on a real engine.
 *
 * Honest edges: renaming the ENTITY itself is a table rename the migration
 * engine does not cover yet — the designer says so and refuses to guess;
 * an invalid working schema produces no plan, only the flag.
 *
 * akao triad: logic here, template in template.js, styles in styles.css.js.
 */

import { Component } from "../../../kernel/UI/Component.js"
import { render } from "../../../kernel/UI.js"
import { validate, diff } from "../../../model/Model.js"
import { migrationPlan } from "../../../data/migrate.js"
import "../form-builder/index.js" // registers <nx-form-builder>
import { designerTemplate } from "./template.js"

const clone = (x) => JSON.parse(JSON.stringify(x))

// ─── pure helpers (pinned in Node) ────────────────────────────────────────────

/** For each removed field: the same-type added fields it could rename to. */
export function renameCandidates(baseline, current) {
    const currentNames = new Set(current.fields.map((f) => f.name))
    const baselineNames = new Set(baseline.fields.map((f) => f.name))
    const added = current.fields.filter((f) => !baselineNames.has(f.name))
    const candidates = {}
    for (const field of baseline.fields)
        if (!currentNames.has(field.name))
            candidates[field.name] = added.filter((a) => a.type === field.type).map((a) => a.name)
    return candidates
}

/**
 * The designer's verdict for a working copy against its baseline.
 * @returns {{hot, changes, migration, reason}}
 */
export function designerPlan(baseline, current, renames = {}) {
    if (!validate(current).valid) return { hot: false, changes: [], migration: null, reason: "invalid" }
    if (baseline.name !== current.name)
        return { hot: false, changes: diff(baseline, current), migration: null, reason: "entity-renamed" }

    const changes = diff(baseline, current)
    if (changes.every((c) => c.class === "additive")) return { hot: true, changes, migration: null, reason: null }

    // Keep only renames whose endpoints still exist (stale picks drop out)
    const valid = {}
    for (const [from, to] of Object.entries(renames))
        if (baseline.fields.some((f) => f.name === from) && current.fields.some((f) => f.name === to)) valid[from] = to

    return { hot: false, changes, migration: migrationPlan(baseline, current, { renames: valid }), reason: null }
}

// ─── <nx-schema-designer> ─────────────────────────────────────────────────────

export class NxSchemaDesigner extends Component {
    #baseline = null
    #renames = {}
    #pending = null

    constructor() {
        super()
        this.attachShadow({ mode: "open" })
    }

    set baseline(schema) {
        this.#baseline = clone(schema)
        this.#renames = {}
        if (this.isConnected) this.mount()
    }

    get baseline() {
        return clone(this.#baseline)
    }

    get value() {
        return this.$builder?.value ?? clone(this.#baseline)
    }

    set value(schema) {
        if (this.$builder) this.$builder.value = schema
        else this.#pending = clone(schema)
        if (this.isConnected) this.#refresh()
    }

    get plan() {
        return designerPlan(this.#baseline, this.value, this.#renames)
    }

    onconnect() {
        this.mount()
    }

    mount() {
        render(designerTemplate(this), this.shadowRoot)

        // THE SECOND REUSE: the editor is nx-form-builder — its change events
        // are absorbed at the boundary and re-emitted in the designer's shape.
        this.$builder = document.createElement("nx-form-builder")
        this.$builder.value = this.#pending ?? clone(this.#baseline)
        this.#pending = null
        this.$builder.addEventListener("change", (e) => {
            e.stopPropagation()
            this.#refresh()
        })
        this.$editor.appendChild(this.$builder)
        this.#refresh(false)
    }

    #emit(plan) {
        this.dispatchEvent(
            new CustomEvent("change", {
                detail: {
                    value: this.value,
                    valid: validate(this.value).valid,
                    hot: plan.hot,
                    changes: plan.changes,
                    migration: plan.migration,
                    reason: plan.reason
                },
                bubbles: true,
                composed: true
            })
        )
    }

    #refresh(emit = true) {
        const plan = this.plan
        this.#renderPanel(plan)
        if (emit) this.#emit(plan)
    }

    #renderPanel(plan) {
        const panel = this.$panel
        panel.replaceChildren()

        const verdict = document.createElement("div")
        if (plan.reason === "invalid") {
            verdict.className = "verdict migration"
            verdict.textContent = "⚠ schema is invalid — fix it to see a plan"
        } else if (plan.reason === "entity-renamed") {
            verdict.className = "verdict migration"
            verdict.textContent = "⚠ entity renamed — a table rename needs a manual migration (not covered by the engine yet)"
        } else if (!plan.changes.length) {
            verdict.className = "verdict hot muted"
            verdict.textContent = "no changes against the baseline"
        } else if (plan.hot) {
            verdict.className = "verdict hot"
            verdict.textContent = "✓ hot-applicable — every change is additive"
        } else {
            verdict.className = "verdict migration"
            verdict.textContent = "requires a migration — review below, then dry-run"
        }
        panel.appendChild(verdict)

        for (const change of plan.changes) {
            const row = document.createElement("div")
            row.className = "change"
            const badge = document.createElement("span")
            badge.className = `badge ${change.class}`
            badge.textContent = change.class
            row.appendChild(badge)
            const text = document.createElement("span")
            text.textContent = change.field ? `${change.field}: ${change.change}` : change.change
            row.appendChild(text)
            panel.appendChild(row)
        }

        // Rename declarations — only where same-type candidates exist
        if (!plan.hot && !plan.reason) {
            const candidates = renameCandidates(this.#baseline, this.value)
            for (const [removed, targets] of Object.entries(candidates)) {
                if (!targets.length) continue
                const row = document.createElement("div")
                row.className = "change rename"
                const label = document.createElement("span")
                label.textContent = `"${removed}" was removed — renamed to:`
                row.appendChild(label)
                const select = document.createElement("select")
                select.dataset.renameFrom = removed
                const none = document.createElement("option")
                none.value = ""
                none.textContent = "(dropped — data will be lost)"
                select.appendChild(none)
                for (const target of targets) {
                    const option = document.createElement("option")
                    option.value = target
                    option.textContent = target
                    select.appendChild(option)
                }
                select.value = this.#renames[removed] ?? ""
                this.listen(select, "change", () => {
                    if (select.value === "") delete this.#renames[removed]
                    else this.#renames[removed] = select.value
                    this.#refresh()
                })
                row.appendChild(select)
                panel.appendChild(row)
            }

            if (plan.migration) {
                const summary = document.createElement("div")
                summary.className = "change muted"
                summary.innerHTML = `migration <code>${plan.migration.id}</code> — apply with <code>nexus migrate</code> (dry-run first, always)`
                panel.appendChild(summary)
            }
        }
    }
}

if (typeof customElements !== "undefined") customElements.define("nx-schema-designer", NxSchemaDesigner)
