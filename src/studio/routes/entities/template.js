/** /entities route template — the directory head + body (list or editor). */

import { html } from "../../../core/UI.js"
import "../../components/context/index.js"

export const entitiesTemplate = (c, { onNew }) => html`
    <div class="nx-head">
        <h1><nx-context data-key="entities" data-fallback="Entities"></nx-context></h1>
        <span class="nx-muted" ${({ element }) => (c.$crumb = element)}></span>
        <span class="nx-spacer"></span>
        <nx-button data-variant="primary" data-icon="plus-lg"
            ${({ element }) => element.addEventListener("click", onNew)}>
            <nx-context data-key="newCollection"></nx-context>
        </nx-button>
    </div>
    <div ${({ element }) => (c.$body = element)}></div>
`

export default { entitiesTemplate }
