/** /settings/themes template — mode row + accent grid. */

import { html } from "../../../../core/UI.js"
import "../../../components/context/index.js"

export const themesTemplate = (c) => html`
    <div class="nx-head">
        <h1><nx-context data-key="themes" data-fallback="Appearance"></nx-context></h1>
    </div>
    <div class="nx-card">
        <div class="nx-setsec">
            <h3><nx-context data-key="themeMode" data-fallback="Mode"></nx-context></h3>
            <div class="nx-options" ${({ element }) => (c.$modes = element)}></div>
        </div>
        <div class="nx-setsec">
            <h3><nx-context data-key="accent" data-fallback="Accent color"></nx-context></h3>
            <div class="nx-options" ${({ element }) => (c.$accents = element)}></div>
        </div>
    </div>
`

export default { themesTemplate }
