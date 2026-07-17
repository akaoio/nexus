/** <nx-navigator> template — orbit ring, state checkbox, slot, icon toggle. */

import { html } from "../../../kernel/UI.js"
import { STYLE } from "./styles.css.js"
import "../icon/index.js"

let uid = 0

export const navigatorTemplate = (c) => {
    const id = "nxnav" + ++uid
    return html`
        ${STYLE()}
        <nav>
            <div id="orbit" ${({ element }) => (c.$orbit = element)}></div>
            <input type="checkbox" id="state" ${({ element }) => { element.id = "state"; c.$state = element }}>
            <section><slot ${({ element }) => (c.$slot = element)}></slot></section>
            <label for="state" id="toggle" ${({ element }) => (c.$toggle = element)}>
                <nx-icon ${({ element }) => (c.$icon = element)}></nx-icon>
            </label>
        </nav>
    `
}

export default { navigatorTemplate }
