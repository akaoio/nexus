/** /entity (data model) route template — picker + designer body. */

import { html } from "../../../../kernel/UI.js"
import "../../../components/t/index.js"

export const modelTemplate = (c) => html`
    <div class="nx-head">
        <h1><nx-t data-key="dataModel"></nx-t></h1>
        <span class="nx-spacer"></span>
        <select class="nx-input" style="max-width:17.5rem" ${({ element }) => (c.$picker = element)}></select>
    </div>
    <div ${({ element }) => (c.$body = element)}></div>
`

export default { modelTemplate }
