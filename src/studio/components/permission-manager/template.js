/** <nx-permission-manager> template — the toolbar + the policy list slot. */

import { html } from "../../../kernel/UI.js"
import { STYLE } from "./styles.css.js"

export const managerTemplate = (c, { count, onAddPolicy }) => html`
    ${STYLE()}
    <div class="line">
        <button class="add-policy" ${({ element }) => c.listen(element, "click", onAddPolicy)}>+ policy</button>
        <span class="muted">${count} policies — additive union (Directus v11 shape)</span>
    </div>
    <div class="policies" ${({ element }) => (c.$policies = element)}></div>
`

export default { managerTemplate }
