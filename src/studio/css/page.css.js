/**
 * The composed Studio page stylesheet — tokens + shared elements + the shell
 * layout, in cascade order. Pure strings (no DOM imports): the dev server
 * serves this as /_nexus/src/studio/studio.css, so the css modules stay
 * the single source of truth — no build step, no duplication.
 */

import { tokens } from "./tokens.css.js"
import { controls } from "./elements/controls.css.js"
import { table } from "./elements/table.css.js"
import { bits } from "./elements/bits.css.js"
import { shell } from "../layouts/studio/styles.css.js"

export const pageStyles = tokens + controls + table + bits + shell

export default pageStyles
