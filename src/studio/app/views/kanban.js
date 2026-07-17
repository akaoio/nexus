/**
 * Kanban view — columns from the entity's first select field (Frappe boards);
 * dragging a card to another column writes that field through the Data Plane
 * (onMove). Available only when the schema HAS a select field — the registry
 * asks via boardField().
 */

import { el } from "../lib.js"

/** The field a board can group by: the first select field, or null. */
export function boardField(schema) {
    return (schema?.fields ?? []).find((f) => f.type === "select" && Array.isArray(f.options)) ?? null
}

export function render({ schema, rows, selection, onRow, onMove }) {
    const field = boardField(schema)
    const title = (schema.fields ?? []).find((f) => f.type === "text")
    const lanes = ["(none)", ...field.options]
    const board = el("div", { class: "nx-kanban" })

    for (const lane of lanes) {
        const laneRows = rows.filter((r) => (lane === "(none)" ? r[field.name] == null || r[field.name] === "" : r[field.name] === lane))
        const cards = el("div", { class: "nx-lane-cards" })
        for (const row of laneRows) {
            const card = el("div", {
                class: "nx-kcard" + (selection.has(row.id) ? " selected" : ""),
                draggable: true,
                onclick: () => onRow(row)
            }, [
                el("div", { class: "nx-kcard-title", text: String(row[title?.name] ?? row.id) }),
                el("div", { class: "nx-pub", text: row.id.slice(0, 10) + "…" })
            ])
            card.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", row.id))
            cards.append(card)
        }
        const laneEl = el("div", { class: "nx-lane" }, [
            el("div", { class: "nx-lane-head" }, [
                el("span", { class: "nx-chip" + (lane === "(none)" ? "" : " accent"), text: lane }),
                el("span", { class: "nx-muted", text: String(laneRows.length) })
            ]),
            cards
        ])
        laneEl.addEventListener("dragover", (e) => e.preventDefault())
        laneEl.addEventListener("drop", (e) => {
            e.preventDefault()
            const id = e.dataTransfer.getData("text/plain")
            const row = rows.find((r) => r.id === id)
            if (row) onMove(row, field.name, lane === "(none)" ? null : lane)
        })
        board.append(laneEl)
    }
    return el("div", { class: "nx-scroll" }, [board])
}

export default { render, boardField }
