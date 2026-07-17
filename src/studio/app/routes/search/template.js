/** /search route template — global search over every readable Entity. */

import { html } from "../../../../kernel/UI.js"
import "../../../components/context/index.js"

export const searchTemplate = (c, { mode, note }) => html`
    <div class="nx-head">
        <h1><nx-context data-key="search"></nx-context></h1>
        <span class="nx-spacer"></span>
        <span class="nx-chip">${mode}</span>
    </div>
    <p class="nx-muted">${note}</p>
    <div class="nx-card" ${({ element }) => (c.$card = element)}></div>
`

export default { searchTemplate }
