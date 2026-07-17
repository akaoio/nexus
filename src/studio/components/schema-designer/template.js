/** <nx-schema-designer> template — editor slot above, verdict panel below. */

import { html } from "../../../kernel/UI.js"
import { STYLE } from "./styles.css.js"

export const designerTemplate = (c) => html`
    ${STYLE()}
    <div ${({ element }) => (c.$editor = element)}></div>
    <div class="panel" ${({ element }) => (c.$panel = element)}></div>
`

export default { designerTemplate }
