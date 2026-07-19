/** /permissions route template — header + banner + matrix + the manager. */

import { html } from "../../../core/UI.js"
import "../../components/context/index.js"

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
    <div class="nx-card">
        <div class="nx-setsec">
            <h3><nx-context data-key="roles" data-fallback="Roles"></nx-context></h3>
            <p class="nx-muted"><nx-context data-key="rolesHint"
                data-fallback="A role is a named bundle: policies below grant through it, users in Users hold it. Type a role on a policy (or a user) and it exists."></nx-context></p>
            <div class="nx-options" ${({ element }) => (c.$roles = element)}></div>
        </div>
    </div>
    <div class="nx-card" ${({ element }) => (c.$matrix = element)}></div>
    <div class="nx-card" ${({ element }) => (c.$baselines = element)}></div>
    <div class="nx-card" ${({ element }) => (c.$manager = element)}></div>
`

export default { permissionsTemplate }
