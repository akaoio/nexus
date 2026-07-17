/** Shared table styles — data cells speak mono (the workbench voice). */

export const table = /* css */ `
.nx-table { border-collapse: collapse; width: 100%; font-size: var(--text-md) }
.nx-table th, .nx-table td {
    border-bottom: 1px solid var(--border); padding: 0.5rem 0.625rem; text-align: left;
    max-width: 16.25rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.nx-table th {
    background: var(--surface-2); font-size: var(--text-xs); text-transform: uppercase;
    letter-spacing: .06em; color: var(--muted); user-select: none; position: sticky; top: 0;
}
.nx-table th.sortable { cursor: pointer }
.nx-table th.sortable:hover { color: var(--text) }
.nx-table td.mono, .nx-table td.num { font-family: var(--mono); font-size: var(--text-sm) }
.nx-table td.num { text-align: right; font-variant-numeric: tabular-nums }
.nx-table tr.clickable { cursor: pointer }
.nx-table tr.clickable:hover td { background: var(--accent-soft) }
`

export default table
