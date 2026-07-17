/**
 * Kanban view — columns from the entity's first select field (Frappe boards);
 * dragging a card to another column writes that field through the Data Plane
 * (onMove). Available only when the schema HAS a select field — the registry
 * asks via boardField().
 */

/** The field a board can group by: the first select field, or null. */
export function boardField(schema) {
    return (schema?.fields ?? []).find((f) => f.type === "select" && Array.isArray(f.options)) ?? null
}

export function render({ schema, rows, selection, onRow, onMove }) {
    const field = boardField(schema)
    const title = (schema.fields ?? []).find((f) => f.type === "text")
    const lanes = ["(none)", ...field.options]
    const board = document.createElement("div")
    board.className = "nx-kanban"

    for (const lane of lanes) {
        const laneRows = rows.filter((r) => (lane === "(none)" ? r[field.name] == null || r[field.name] === "" : r[field.name] === lane))
        const cards = document.createElement("div")
        cards.className = "nx-lane-cards"
        for (const row of laneRows) {
            const card = document.createElement("div")
            card.className = "nx-kcard" + (selection.has(row.id) ? " selected" : "")
            card.draggable = true
            card.addEventListener("click", () => onRow(row))
            const cardTitle = document.createElement("div")
            cardTitle.className = "nx-kcard-title"
            cardTitle.textContent = String(row[title?.name] ?? row.id)
            const cardId = document.createElement("div")
            cardId.className = "nx-pub"
            cardId.textContent = row.id.slice(0, 10) + "…"
            card.append(cardTitle, cardId)
            card.addEventListener("dragstart", (e) => e.dataTransfer.setData("text/plain", row.id))
            cards.append(card)
        }
        const laneEl = document.createElement("div")
        laneEl.className = "nx-lane"
        const laneHead = document.createElement("div")
        laneHead.className = "nx-lane-head"
        const laneChip = document.createElement("span")
        laneChip.className = "nx-chip" + (lane === "(none)" ? "" : " accent")
        laneChip.textContent = lane
        const laneCount = document.createElement("span")
        laneCount.className = "nx-muted"
        laneCount.textContent = String(laneRows.length)
        laneHead.append(laneChip, laneCount)
        laneEl.append(laneHead, cards)
        laneEl.addEventListener("dragover", (e) => e.preventDefault())
        laneEl.addEventListener("drop", (e) => {
            e.preventDefault()
            const id = e.dataTransfer.getData("text/plain")
            const row = rows.find((r) => r.id === id)
            if (row) onMove(row, field.name, lane === "(none)" ? null : lane)
        })
        board.append(laneEl)
    }
    const scroll = document.createElement("div")
    scroll.className = "nx-scroll"
    scroll.append(board)
    return scroll
}

export default { render, boardField }
