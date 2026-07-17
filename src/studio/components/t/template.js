/** <nx-t> template — the shadow is just the resolved text slot. */

import { html } from "../../../kernel/UI.js"
import { STYLE } from "./styles.css.js"

export const tTemplate = (c) => html`${STYLE()}<span ${({ element }) => (c.$text = element)}></span>`

export default { tTemplate }
