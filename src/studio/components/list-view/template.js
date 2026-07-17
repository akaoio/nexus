/** <nx-list-view> template — the toolbar and the table skeleton. */

import { html } from "../../../core/UI.js"
import { STYLE } from "./styles.css.js"

export const listTemplate = (c, { columns, groupBy, count, onGroupBy, onExport }) => html`
    ${STYLE()}
    <div class="bar">
        <label class="muted">group by
            <select class="group-by" ${({ element }) => {
                const none = document.createElement("option")
                none.value = ""
                none.textContent = "(none)"
                element.appendChild(none)
                for (const column of columns) {
                    const option = document.createElement("option")
                    option.value = column
                    option.textContent = column
                    element.appendChild(option)
                }
                element.value = groupBy
                c.listen(element, "change", () => onGroupBy(element.value))
            }}></select>
        </label>
        <button class="export" ${({ element }) => c.listen(element, "click", onExport)}>export csv</button>
        <span class="muted count">${count} rows</span>
    </div>
    <table>
        <thead><tr ${({ element }) => (c.$head = element)}></tr></thead>
        <tbody ${({ element }) => (c.$body = element)}></tbody>
    </table>
`

export default { listTemplate }
