/** /settings route template — config sections fill the card. */

import { html } from "../../../core/UI.js"
import "../../components/context/index.js"

export const settingsTemplate = (c) => html`
    <div class="nx-head">
        <h1><nx-context data-key="settings"></nx-context></h1>
    </div>
    <div class="nx-card" ${({ element }) => (c.$body = element)}>
        <p class="nx-muted">…</p>
    </div>
`

export default { settingsTemplate }
