/** /roles route template — the bundles head + create row + list. */

import { html } from "../../../core/UI.js"
import "../../components/context/index.js"

export const rolesTemplate = (c, { onCreate }) => html`
    <div class="nx-head">
        <h1><nx-context data-key="roles" data-fallback="Roles"></nx-context></h1>
        <span class="nx-spacer"></span>
    </div>
    <div class="nx-card">
        <p class="nx-muted"><nx-context data-key="rolesHint"
            data-fallback="A role is a named bundle: policies grant through it, users hold it."></nx-context></p>
        <div class="nx-fields-row">
            <input class="nx-input" placeholder="role name (e.g. editor)" ${({ element }) => (c.$name = element)}>
            <input class="nx-input" placeholder="description" ${({ element }) => (c.$description = element)}>
            <nx-button data-variant="primary" data-icon="plus-lg"
                ${({ element }) => element.addEventListener("click", onCreate)}>Create role</nx-button>
        </div>
    </div>
    <div ${({ element }) => (c.$list = element)}></div>
`

export default { rolesTemplate }
