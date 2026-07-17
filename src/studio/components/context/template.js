/** <nx-context> template — the shadow is just the resolved text. */

import { html } from "../../../core/UI.js"
import { STYLE } from "./styles.css.js"

export const contextTemplate = (c) => html`${STYLE()}<span ${({ element }) => (c.$text = element)}></span>`

export default { contextTemplate }
