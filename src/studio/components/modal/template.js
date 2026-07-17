/** <nx-modal> template — dialog + header (nx-t) + close + slotted body. */

import { html } from "../../../kernel/UI.js"
import { STYLE } from "./styles.css.js"
import "../icon/index.js"
import "../context/index.js"

export const modalTemplate = (c) => html`
    ${STYLE()}
    <dialog ${({ element }) => (c.dialog = element)}>
        <header>
            <nx-context ${({ element }) => (c.$header = element)}></nx-context>
            <span class="spacer"></span>
            <span class="close" ${({ element }) => c.listen?.(element, "click", () => c.close()) ?? element.addEventListener("click", () => c.close())}>
                <nx-icon name="x-lg"></nx-icon>
            </span>
        </header>
        <div class="body"><slot></slot></div>
    </dialog>
`

export default { modalTemplate }
