/** <nx-navigator> template — the akao original: orbit ring, state checkbox,
 *  slotted planets, and a toggle carrying BOTH the 3-span hamburger (morphs
 *  to an X when open) and an optional icon (which flies out to the planet's
 *  own orbit spot while its sub-system recenters). */

import { html } from "../../../kernel/UI.js"
import { STYLE } from "./styles.css.js"
import "../icon/index.js"

export const navigatorTemplate = (c) => html`
    ${STYLE()}
    <nav>
        <div id="orbit" ${({ element }) => (c.$orbit = element)}></div>
        <input type="checkbox" id="state" ${({ element }) => (c.$state = element)}>
        <section><slot ${({ element }) => (c.$slot = element)}></slot></section>
        <div id="toggle" ${({ element }) => (c.$toggle = element)}>
            <div>
                <span></span>
                <span></span>
                <span></span>
            </div>
            <nx-icon ${({ element }) => (c.$icon = element)}></nx-icon>
        </div>
    </nav>
`

export default { navigatorTemplate }
