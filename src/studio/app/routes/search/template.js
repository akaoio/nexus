/** /search route template — global search over every readable Entity. */

import { html } from "../../../../kernel/UI.js"
import "../../../components/t/index.js"

export const searchTemplate = (c, { mode, note }) => html`
    <div class="nx-head">
        <h1><nx-t data-key="search"></nx-t></h1>
        <span class="nx-spacer"></span>
        <span class="nx-chip">${mode}</span>
    </div>
    <p class="nx-muted">${note}</p>
    <div class="nx-card" ${({ element }) => (c.$card = element)}></div>
`

export default { searchTemplate }
