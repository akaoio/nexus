/** /permissions route template — header + banner + matrix + the manager. */

import { html } from "../../../../kernel/UI.js"
import "../../../components/context/index.js"

export const permissionsTemplate = (c, { onSave }) => html`
    <div class="nx-head">
        <h1><nx-context data-key="permissions"></nx-context></h1>
        <span class="nx-muted" ${({ element }) => (c.$status = element)}></span>
        <span class="nx-spacer"></span>
        <nx-button data-variant="primary" ${({ element }) => element.addEventListener("click", onSave)}>
            <nx-context data-key="savePolicies"></nx-context>
        </nx-button>
    </div>
    <div ${({ element }) => (c.$banner = element)}></div>
    <div class="nx-card" ${({ element }) => (c.$matrix = element)}></div>
    <div class="nx-card" ${({ element }) => (c.$manager = element)}></div>
`

export default { permissionsTemplate }
