/** /users route template — identities list + add-by-key row. */

import { html } from "../../../../kernel/UI.js"
import "../../../components/context/index.js"

export const usersTemplate = (c, { onAddMe, onAdd }) => html`
    <div class="nx-head">
        <h1><nx-context data-key="users"></nx-context></h1>
        <span class="nx-spacer"></span>
        <nx-button data-icon="plus-lg" ${({ element }) => element.addEventListener("click", onAddMe)}>Add me as admin</nx-button>
    </div>
    <div ${({ element }) => (c.$banner = element)}></div>
    <div class="nx-card" ${({ element }) => (c.$list = element)}><p class="nx-muted">…</p></div>
    <div class="nx-card">
        <p class="nx-muted">Add an identity by public key — the person signs in with the passphrase that derives it. Roles connect identities to Permissions policies.</p>
        <div class="nx-fields-row">
            <input class="nx-input" placeholder="public key" ${({ element }) => (c.$pub = element)}>
            <input class="nx-input" placeholder="name" ${({ element }) => (c.$name = element)}>
            <input class="nx-input" placeholder="roles (comma) e.g. admin,editor" ${({ element }) => (c.$roles = element)}>
            <nx-button data-variant="primary" ${({ element }) => element.addEventListener("click", onAdd)}>Add user</nx-button>
        </div>
    </div>
`

export default { usersTemplate }
