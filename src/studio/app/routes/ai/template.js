/** /ai route template — the embedding model panel. */

import { html } from "../../../../kernel/UI.js"
import "../../../components/t/index.js"

export const aiTemplate = (c) => html`
    <div class="nx-head">
        <h1><nx-t data-key="ai"></nx-t></h1>
    </div>
    <div class="nx-card" ${({ element }) => (c.$body = element)}>
        <p class="nx-muted">…</p>
    </div>
`

export default { aiTemplate }
