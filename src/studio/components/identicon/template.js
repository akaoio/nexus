/** <nx-identicon> template — one svg canvas; cells paint from the seed. */

import { html } from "../../../core/UI.js"
import { STYLE } from "./styles.css.js"

export const identiconTemplate = (c) => html`${STYLE()}<svg ${({ element }) => (c.$svg = element)}></svg>`

export default { identiconTemplate }
