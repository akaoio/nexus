/**
 * View registry — the Directus-layouts lesson as architecture: a VIEW is a
 * module with one contract, registered here; adding calendar/gantt/gallery
 * later means adding a module, never touching existing views or the content
 * screen.
 *
 * Contract: render({ schema, rows, selection, onRow, onMove }) → Element
 *   - selection: the pure selection model (app/selection.js) — views paint
 *     checkboxes/highlights from it and call toggle/all/invert on it.
 *   - onRow(row): open the record.
 *   - onMove(row, field, value): a view-initiated field change (kanban drag).
 */

import * as list from "./list.js"
import * as kanban from "./kanban.js"

export const VIEWS = [
    { id: "list", icon: "list-ul", label: "List", render: list.render, available: () => true },
    { id: "kanban", icon: "kanban", label: "Kanban", render: kanban.render, available: (schema) => kanban.boardField(schema) !== null }
]

export default { VIEWS }
