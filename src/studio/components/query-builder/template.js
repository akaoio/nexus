/**
 * <nx-query-builder> templates — the DOM shapes of the condition row, the
 * group bar and the empty root (akao template pattern: structure here, logic
 * in index.js). Each template is a function of the component instance because
 * the builder renders per-state, not once.
 */

import { html } from "../../../kernel/UI.js"
import { STYLE } from "./styles.css.js"

/** A leaf row: field · operator · value slot · remove. */
export const conditionTemplate = (c, { fields, operators, node, onField, onOperator, onRemove, mountValue }) => html`
    ${STYLE()}
    <div class="row">
        <select class="field" ${({ element }) => {
            for (const def of fields) {
                const option = document.createElement("option")
                option.value = def.name
                option.textContent = def.name
                element.appendChild(option)
            }
            element.value = node.field
            c.listen(element, "change", () => onField(element.value))
        }}></select>
        <select class="operator" ${({ element }) => {
            for (const op of operators) {
                const option = document.createElement("option")
                option.value = op
                option.textContent = op
                element.appendChild(option)
            }
            element.value = node.operator
            c.listen(element, "change", () => onOperator(element.value))
        }}></select>
        <span class="value-slot" ${({ element }) => mountValue(element)}></span>
        <button class="remove" title="remove condition" ${({ element }) => c.listen(element, "click", onRemove)}>×</button>
    </div>
`

/** A group: AND/OR · NOT · add condition/group · remove · children slot. */
export const groupTemplate = (c, { node, negated, onOp, onNegate, onAddCondition, onAddGroup, onRemove }) => html`
    ${STYLE()}
    <div class="group ${negated ? "negated" : ""}">
        <div class="bar">
            <select class="op" ${({ element }) => {
                element.value = node.op
                c.listen(element, "change", () => onOp(element.value))
            }}>
                <option value="and">AND</option>
                <option value="or">OR</option>
            </select>
            <label class="negate"><input type="checkbox" class="negate-box" ${({ element }) => {
                element.checked = negated === true
                c.listen(element, "change", () => onNegate(element.checked))
            }}>NOT</label>
            <button class="add-condition" ${({ element }) => c.listen(element, "click", onAddCondition)}>+ condition</button>
            <button class="add-group" ${({ element }) => c.listen(element, "click", onAddGroup)}>+ group</button>
            <button class="remove" title="remove group" ${({ element }) => c.listen(element, "click", onRemove)}>×</button>
        </div>
        <div class="children" ${({ element }) => (c.$children = element)}></div>
    </div>
`

/** The empty root: "match everything" + the first condition. */
export const emptyTemplate = (c, { onAdd }) => html`
    ${STYLE()}
    <div class="bar">
        <span class="empty">match everything</span>
        <button class="add-condition" ${({ element }) => c.listen(element, "click", onAdd)}>+ condition</button>
    </div>
`

/** The root wrapper when a document exists. */
export const rootTemplate = (c) => html`${STYLE()}<div ${({ element }) => (c.$root = element)}></div>`

export default { conditionTemplate, groupTemplate, emptyTemplate, rootTemplate }
