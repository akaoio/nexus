/** /settings route template — config sections fill the card. */

import { html } from "../../../../kernel/UI.js"
import "../../../components/t/index.js"

export const settingsTemplate = (c) => html`
    <div class="nx-head">
        <h1><nx-t data-key="settings"></nx-t></h1>
    </div>
    <div class="nx-card" ${({ element }) => (c.$body = element)}>
        <p class="nx-muted">…</p>
    </div>
`

export default { settingsTemplate }
