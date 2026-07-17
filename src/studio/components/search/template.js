/** <nx-search> template — one query box, results grouped per entity. */

import { html } from "../../../core/UI.js"
import { STYLE } from "./styles.css.js"

export const searchTemplate = (c, { onInput }) => html`
    ${STYLE()}
    <input class="query" placeholder="search everything…" ${({ element }) => {
        c.$query = element
        c.listen(element, "input", onInput)
    }}>
    <div class="results" ${({ element }) => (c.$results = element)}></div>
`

export default { searchTemplate }
