/**
 * Saved views (ARCHITECTURE.md §7) — the piece <nx-list-view> deferred "to the
 * app system's storage story". A saved view is not a new storage layer: it is
 * ordinary DATA. `nexus_view` is a first-class system entity, so views persist
 * through the very same Data Plane as everything else — permissioned (a user
 * sees their own views), ownable, and synced across a user's devices for free.
 *
 * A view captures a list's shape: its filter (a Query AST document), sort,
 * group, and visible columns. `applyView` reconstructs the exact list from
 * rows + a view, so a saved view reproduces what the user saw — proven pure.
 */

import * as AST from "./AST.js"

// ─── pure list mechanics (shared by <nx-list-view> and applyView) ─────────────

/** Stable sort with strict types and nulls-last (both directions). */
export function sortRows(rows, field, dir = "asc") {
    const factor = dir === "desc" ? -1 : 1
    return [...rows].sort((a, b) => {
        const va = a?.[field]
        const vb = b?.[field]
        const aNull = va === null || va === undefined
        const bNull = vb === null || vb === undefined
        if (aNull && bNull) return 0
        if (aNull) return 1 // nulls last, always
        if (bNull) return -1
        if (typeof va !== typeof vb) return 0 // cross-type: no opinion
        if (va < vb) return -1 * factor
        if (va > vb) return 1 * factor
        return 0
    })
}

/** Group rows by a field value; null/missing collect under "(none)". */
export function groupRows(rows, field) {
    const groups = new Map()
    for (const row of rows) {
        const raw = row?.[field]
        const key = raw === null || raw === undefined ? "(none)" : String(raw)
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key).push(row)
    }
    return groups
}

/** The frozen system-entity schema for a saved view (Model Schema v1). */
export function viewSchema() {
    return {
        name: "nexus_view",
        schemaVersion: 1,
        fields: [
            { name: "name", type: "text", required: true },
            { name: "entity", type: "text", required: true },
            // The list shape, serialized: { filter, sort, group, columns }.
            { name: "config", type: "text", required: true }
        ]
    }
}

const CONFIG_KEYS = ["filter", "sort", "group", "columns"]

/** Pack a view's shape into the row's `config` text (stable, JSON). */
export function packView(view) {
    const config = {}
    for (const key of CONFIG_KEYS) if (view[key] !== undefined) config[key] = view[key]
    return { name: view.name, entity: view.entity, config: JSON.stringify(config) }
}

/** Unpack a stored `nexus_view` row back into a view object. */
export function unpackView(row) {
    const config = row?.config ? JSON.parse(row.config) : {}
    return { id: row.id, owner: row.owner, name: row.name, entity: row.entity, ...config }
}

/**
 * Reconstruct the list a view describes: filter (Query AST) → sort → column
 * projection. Pure; order of operations is filter, then sort, then project.
 * `group` is returned alongside (grouping is a render concern, not a row edit).
 * @returns {{rows: Array, groups: Map|null}}
 */
export function applyView(rows, view = {}) {
    let out = rows
    if (view.filter && view.filter.root) out = out.filter(AST.predicate(view.filter))
    if (view.sort?.field) out = sortRows(out, view.sort.field, view.sort.dir)
    if (Array.isArray(view.columns) && view.columns.length)
        out = out.map((row) => Object.fromEntries(view.columns.filter((c) => c in row).map((c) => [c, row[c]])))
    const groups = view.group ? groupRows(out, view.group) : null
    return { rows: out, groups }
}

// ─── persistence through the Data Plane (the app storage story) ────────────────

/** Save a view (create). Returns the stored row's view form. */
export async function saveView(plane, view, ctx) {
    const created = await plane.create("nexus_view", packView(view), ctx)
    return unpackView(created)
}

/** Overwrite an existing view by id. */
export async function updateView(plane, id, view, ctx) {
    const updated = await plane.update("nexus_view", id, packView(view), ctx)
    return unpackView(updated)
}

/** A user's saved views for one entity (permission-scoped by the plane). */
export async function listViews(plane, entity, ctx) {
    const rows = await plane.list("nexus_view", { filter: { astVersion: 1, root: { field: "entity", operator: "eq", value: entity } } }, ctx)
    return rows.map(unpackView)
}

/** Load a single saved view by id. */
export async function getView(plane, id, ctx) {
    const row = await plane.get("nexus_view", id, ctx)
    return row ? unpackView(row) : null
}

/** Delete a saved view. */
export async function removeView(plane, id, ctx) {
    return plane.remove("nexus_view", id, ctx)
}

export default { sortRows, groupRows, viewSchema, packView, unpackView, applyView, saveView, updateView, listViews, getView, removeView }
