/** <nx-search> template — one query box, results grouped per entity. */

import { html } from "../../../core/UI.js"
import { STYLE } from "./styles.css.js"

export const searchTemplate = (c, { onInput, onKeydown }) => html`
    ${STYLE()}
    <input class="query" placeholder="search everything…" role="combobox" aria-expanded="false"
        aria-controls="nx-search-results" aria-autocomplete="list" ${({ element }) => {
        c.$query = element
        c.listen(element, "input", onInput)
        // Keyboard is not a convenience here: without it a keyboard or
        // screen-reader user cannot reach a result at all (NXSR-KEY-01).
        c.listen(element, "keydown", onKeydown)
    }}>
    <div class="results" id="nx-search-results" role="listbox" ${({ element }) => (c.$results = element)}></div>
`

export default { searchTemplate }
