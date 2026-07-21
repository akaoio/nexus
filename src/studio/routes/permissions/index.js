/** /permissions route — the page tells the WHOLE truth (design 2026-07-19):
 *  every layer the engine composes — read-only baselines with their source
 *  labels + the editable nexus_policy ROWS — and the matrix verdict runs
 *  over the full composed set. Saving is a diff of ordinary entity-API row
 *  writes; there is no bespoke permissions write endpoint anymore. */

import { mountTemplate, toast, subscribe, onUnmount } from "../../kit/index.js"
import { detailLine } from "../../components/row/detail.js"
import "../../components/row/index.js"
import "../../components/matrix/index.js"
import { rolesIn } from "../../../core/App/policies.js"
import { packPolicy } from "../../../core/App/system.js"
import { permissionsTemplate } from "./template.js"

// id/source are annotations — strip before comparing content
const strip = ({ id, source, ...policy }) => policy
const same = (a, b) => JSON.stringify(strip(a ?? {})) === JSON.stringify(strip(b ?? {}))
const parseRoles = (row) => { try { return row.roles ? JSON.parse(row.roles) : [] } catch { return [] } }

export function render(ctx) {
    const mgr = document.createElement("nx-permission-manager")
    mgr.schemas = ctx.schemas
    const matrix = document.createElement("nx-matrix")

    let baseline = [] // flattened read-only layers (each policy keeps its source)
    let saved = []    // the rows layer as last loaded: [{ id, …policy }]
    let users = []    // nexus_user rows (for the roles overview)
    const composed = (rows) => [...baseline, ...rows]

    const c = {}
    const host = mountTemplate(permissionsTemplate(c, {
        onSave: async () => {
            c.$save.disabled = true
            const value = mgr.value
            let clean = false
            try {
                const before = new Map(saved.map((r) => [r.id, r]))
                const results = []
                for (const p of value) {
                    if (!p.id) results.push(await ctx.api.create("nexus_policy", packPolicy(p)))
                    else if (!before.has(p.id) || !same(p, before.get(p.id))) results.push(await ctx.api.update("nexus_policy", p.id, packPolicy(p)))
                }
                const kept = new Set(value.map((p) => p.id).filter(Boolean))
                for (const r of saved) if (!kept.has(r.id)) results.push(await ctx.api.remove("nexus_policy", r.id))
                const failed = results.filter((r) => !r.ok)
                clean = !failed.length
                if (clean) toast("Policies saved — live now", "ok")
                else for (const f of failed) toast(f.error.code + ": " + (f.error.message || ""), "err") // per-row truth (spec §6)
            } catch (error) {
                toast(String(error?.message ?? error), "err")
            } finally {
                c.$save.disabled = false
                // re-sync from the window; a failed save KEEPS the edits that
                // did not land, so a veto never wipes the draft being corrected
                load(clean ? null : value)
            }
        }
    }))
    c.$matrix.append(matrix)
    c.$manager.append(mgr)
    mgr.addEventListener("change", (e) => {
        matrix.policies = composed(e.detail.value)
        paintRoles(composed(e.detail.value))
    })

    /** The roles overview — each role is a BUNDLE: n policies grant through it, n users hold it. */
    function paintRoles(policies) {
        const overview = rolesIn(policies, users)
        c.$roles.replaceChildren()
        if (!overview.length) {
            const none = document.createElement("p")
            none.className = "nx-muted"
            none.textContent = "No roles yet — every policy below applies to all authenticated users."
            return c.$roles.append(none)
        }
        for (const r of overview) {
            const card = document.createElement("span")
            card.className = "nx-rolecard"
            const name = document.createElement("strong")
            name.textContent = r.role
            const spec = document.createElement("span")
            spec.className = "nx-muted"
            spec.textContent = `${r.policies} ${r.policies === 1 ? "policy" : "policies"} · ${r.users} ${r.users === 1 ? "user" : "users"}`
            card.append(name, spec)
            if (!r.policies) card.title = "Held by users but granting nothing — attach it to a policy below"
            if (!r.users) card.title = "Grants policies but nobody holds it — assign it in Users"
            c.$roles.append(card)
        }
    }

    /** Read-only layers, labeled by source — the floor the rows layer adds onto. */
    function paintBaselines(layers) {
        c.$baselines.replaceChildren()
        const head = document.createElement("h3")
        head.textContent = "Baselines (read-only)"
        const hint = document.createElement("p")
        hint.className = "nx-muted"
        hint.textContent = "Shipped floors — composition is additive, so these grants always hold. App files change through git; system and admin ship with nexus."
        c.$baselines.append(head, hint)
        for (const layer of layers) {
            if (!layer.policies.length) continue
            const src = document.createElement("p")
            src.className = "nx-muted"
            src.textContent = layer.source
            c.$baselines.append(src)
            for (const p of layer.policies) {
                const row = document.createElement("nx-row")
                row.dataset.label = `${p.entity} · ${(p.actions ?? []).join(", ")}`
                row.dataset.detail = detailLine([
                    p.roles?.length ? "roles: " + p.roles.join(", ") : "all authenticated",
                    p.rule ? "rule-scoped" : null,
                    p.ifOwner ? "ifOwner" : null
                ])
                c.$baselines.append(row)
            }
        }
    }

    /** Re-sync from the window. `drafts` (a failed save's value) survives the
     *  reload: rows that saved show server truth, edits that did NOT land stay
     *  in the manager — changed rows keep the draft version, new entries whose
     *  create failed stay as id-less drafts. */
    async function load(drafts = null) {
        // The layer view moved to GET /api/v1/_policy-layers (Task 3, issue
        // #10) — an ordinary, admin-authorized API route, so it no longer
        // rides along with a devMode flag. That comes from the one place
        // that already knows, the same session probe Users uses.
        const [w, u, s] = await Promise.all([ctx.api.get("/api/v1/_policy-layers"), ctx.api.list("nexus_user", null), ctx.api.session()])
        if (!w.ok) return
        users = u.ok ? u.data.map((row) => ({ ...row, roles: parseRoles(row) })) : []
        const layers = w.data.layers ?? []
        const readonly = layers.filter((l) => l.readonly)
        baseline = readonly.flatMap((l) => l.policies.map((p) => ({ ...p, source: p.source ?? l.source })))
        saved = layers.find((l) => l.source === "rows")?.policies ?? []
        let value = saved
        if (drafts) value = [
            ...saved.map((r) => drafts.find((d) => d.id === r.id && !same(d, r)) ?? r),
            ...drafts.filter((d) => !d.id && !saved.some((r) => same(r, d)))
        ]
        mgr.value = value
        matrix.policies = composed(value)
        paintRoles(composed(value))
        paintBaselines(readonly)
        c.$status.textContent = `${baseline.length} baseline · ${saved.length} rows`
        c.$banner.replaceChildren()
        // A FAILED session probe must never read as "auth is required, all
        // clear" — an unknown auth state warns too, it just doesn't know
        // which warning to give (previously this rode the SAME response as
        // the layers and could not fail independently; now it is a second
        // fetch, so a failure here is a real, distinct case to handle).
        if (!s.ok || !s.data.authRequired) {
            const card = document.createElement("div")
            card.className = "nx-card nx-note"
            const b = document.createElement("b")
            const span = document.createElement("span")
            span.className = "nx-muted"
            if (s.ok) {
                b.textContent = "DEV mode — policies are not enforced yet."
                span.textContent = " Without identities every request runs as the wide-open DEV admin, so nothing is denied. Add an identity in Users (e.g. “Add me as admin”) to turn authentication on — from that moment these policies decide who can do what."
            } else {
                b.textContent = "Auth state unknown — could not confirm whether policies are enforced."
                span.textContent = " The session probe failed, so this page cannot say whether authentication is required. Treat access as unverified until it succeeds."
            }
            card.append(b, document.createElement("br"), span)
            c.$banner.append(card)
        }
    }
    load()

    // live refresh: coarse but truthful — re-run load() on any matching event
    let reloadTimer = null
    onUnmount(subscribe(["nexus_policy", "nexus_user"], () => {
        clearTimeout(reloadTimer)
        reloadTimer = setTimeout(load, 250) // collapse bursts into one reload
    }))
    // the burst-collapse timer is a route resource too — the old
    // isConnected pattern was subscription-shaped and could not reach it,
    // so a timer scheduled just before navigating still fired on a dead route
    onUnmount(() => clearTimeout(reloadTimer))
    return host
}
