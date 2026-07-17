/** <nx-navigator> template — the akao original, verbatim (ui-icon → nx-icon). */

import { html } from "../../../core/UI.js"
import { STYLE } from "./styles.css.js"
import "../icon/index.js"

export const navigatorTemplate = (c) => html`
    ${STYLE()}
    <nav>
        <div id="orbit"></div>
        <input type="checkbox" id="state" ${({ element }) => (c.$state = element)}>
        <section>
            <slot ${({ element }) => (c.$slot = element)}></slot>
        </section>
        <label for="state" id="toggle" ${({ element }) => (c.$toggle = element)}>
            <div>
                <span></span>
                <span></span>
                <span></span>
            </div>
            <nx-icon ${({ element }) => (c.$icon = element)}></nx-icon>
        </label>
    </nav>
`

export default { navigatorTemplate }
