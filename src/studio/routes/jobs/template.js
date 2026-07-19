/** /jobs route template — job queue list grouped by status. */

import { html } from "../../../core/UI.js"
import "../../components/context/index.js"

export const jobsTemplate = (c) => html`
    <div class="nx-head">
        <h1><nx-context data-key="jobs"></nx-context></h1>
        <span class="nx-spacer"></span>
    </div>
    <div class="nx-card" ${({ element }) => (c.$body = element)}><p class="nx-muted">…</p></div>
`

export default { jobsTemplate }
