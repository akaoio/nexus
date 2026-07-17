/** <nx-notifications> template — the stack host; notes are appended live. */

import { html } from "../../../kernel/UI.js"
import { STYLE } from "./styles.css.js"

export const notificationsTemplate = (c) => html`${STYLE()}<div ${({ element }) => (c.$stack = element)}></div>`

export default { notificationsTemplate }
