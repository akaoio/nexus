/** /entity/[entity] route template — head, ask/filter toolbar, bulk bar,
 *  and the results host the active view renders into. */

import { html } from "../../../../../kernel/UI.js"
import "../../../../components/t/index.js"
import "../../../../components/button/index.js"

export const entityTemplate = (c, { name, onNew, onAsk, onClear, onToggleFilter }) => html`
    <div class="nx-head">
        <h1>${name}</h1>
        <span class="nx-muted" ${({ element }) => (c.$count = element)}></span>
        <span class="nx-spacer"></span>
        <span class="nx-toolbar" ${({ element }) => (c.$switcher = element)}></span>
        <nx-button data-variant="primary" data-icon="plus-lg" ${({ element }) => element.addEventListener("click", onNew)}>
            <nx-t data-key="newRecord"></nx-t>
        </nx-button>
    </div>
    <div class="nx-card">
        <div class="nx-toolbar">
            <input class="nx-input" style="flex:1;width:auto"
                ${({ element }) => {
                    c.$ask = element
                    element.addEventListener("keydown", (e) => { if (e.key === "Enter") onAsk(element.value) })
                }}>
            <nx-button data-icon="funnel" ${({ element }) => element.addEventListener("click", onToggleFilter)}>
                <nx-t data-key="filter" ${({ element }) => (c.$filterLabel = element)}></nx-t>
                <span ${({ element }) => (c.$filterCount = element)}></span>
            </nx-button>
            <nx-button data-variant="icon" data-icon="x-lg" title="Clear" ${({ element }) => element.addEventListener("click", onClear)}></nx-button>
        </div>
        <div class="nx-muted" style="font-family:var(--mono);font-size:var(--text-sm);margin-top:0.375rem" ${({ element }) => (c.$filterInfo = element)}></div>
    </div>
    <div class="nx-card" hidden ${({ element }) => (c.$filterCard = element)}></div>
    <div class="nx-bulkbar" hidden ${({ element }) => (c.$bulkbar = element)}></div>
    <div class="nx-err" ${({ element }) => (c.$error = element)}></div>
    <div ${({ element }) => (c.$results = element)}></div>
`

export default { entityTemplate }
