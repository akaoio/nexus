/** /entity (data model) route template — entity tiles + designer body.
 *  The picker is the same option-tile grammar as the settings pages: one
 *  visual language for "choose one of these" everywhere. */

import { html } from "../../../core/UI.js"
import "../../components/context/index.js"

export const modelTemplate = (c, { onNew }) => html`
    <div class="nx-head">
        <h1><nx-context data-key="dataModel"></nx-context></h1>
        <span class="nx-spacer"></span>
        <nx-button data-variant="primary" data-icon="plus-lg"
            ${({ element }) => element.addEventListener("click", onNew)}>
            <nx-context data-key="newCollection"></nx-context>
        </nx-button>
    </div>
    <div class="nx-options" style="margin-bottom: var(--sp-4)" ${({ element }) => (c.$picker = element)}></div>
    <div ${({ element }) => (c.$body = element)}></div>
`

export default { modelTemplate }
