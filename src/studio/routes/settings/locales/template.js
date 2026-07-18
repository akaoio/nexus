/** /settings/locales template — the language grid fills the card. */

import { html } from "../../../../core/UI.js"
import "../../../components/context/index.js"

export const localesTemplate = (c) => html`
    <div class="nx-head">
        <h1><nx-context data-key="languages" data-fallback="Languages"></nx-context></h1>
    </div>
    <div class="nx-card nx-options" ${({ element }) => (c.$body = element)}></div>
`

export default { localesTemplate }
