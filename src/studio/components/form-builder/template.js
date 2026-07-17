/** <nx-form-builder> / <nx-form> templates — structure only, logic in index.js. */

import { html } from "../../../kernel/UI.js"
import { STYLE } from "./styles.css.js"

/** The form runtime shell — fields are appended by the component. */
export const formTemplate = (c) => html`${STYLE()}<form ${({ element }) => (c.$form = element)}></form>`

/** The builder: entity head (name/label/add) + field rows + live preview. */
export const builderTemplate = (c, { schema, onName, onLabel, onAddField }) => html`
    ${STYLE()}
    <div class="head">
        <label>Entity <input class="entity-name" ${({ element }) => {
            element.value = schema.name ?? ""
            c.listen(element, "input", () => onName(element.value))
        }}></label>
        <label>Label <input class="entity-label" ${({ element }) => {
            element.value = schema.label?.en ?? ""
            c.listen(element, "input", () => onLabel(element.value))
        }}></label>
        <button class="add-field" ${({ element }) => c.listen(element, "click", onAddField)}>+ field</button>
        <span class="muted">${schema.fields.length} fields — order is form order</span>
    </div>
    <div class="rows" ${({ element }) => (c.$rows = element)}></div>
    <div class="preview">
        <span class="muted">Live preview (nx-form rendering this schema):</span>
        <div ${({ element }) => (c.$previewSlot = element)}></div>
    </div>
`

export default { formTemplate, builderTemplate }
