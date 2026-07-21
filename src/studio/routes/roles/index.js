/** /roles route — role management as plain entity CRUD (nexus_role rows).
 *  Each role card shows its REACH live: the policies granting through it
 *  (db rows + shipped baselines) and the users holding it. Deleting a role
 *  never cascades silently — the card says exactly what still references
 *  the name before you confirm. */

import { mountTemplate, button, toast, confirmDialog, subscribe, onUnmount } from "../../kit/index.js"
import { rolesTemplate } from "./template.js"

const rolesOf = (jsonText) => (jsonText ? JSON.parse(jsonText) : [])

export function render(ctx) {
    const c = {}
    const host = mountTemplate(rolesTemplate(c, {
        onCreate: async () => {
            const name = c.$name.value.trim()
            if (!name) return toast("A role name is required", "err")
            const r = await ctx.api.create("nexus_role", { name, description: c.$description.value.trim() || null })
            if (!r.ok) return toast(r.error.code + ": " + (r.error.message || ""), "err")
            c.$name.value = c.$description.value = ""
            toast("Role created")
            load()
        }
    }))

    async function load() {
        const [roles, users, policies, layers] = await Promise.all([
            ctx.api.list("nexus_role", null),
            ctx.api.list("nexus_user", null),
            ctx.api.list("nexus_policy", null),
            ctx.api.get("/api/v1/_policy-layers") // Task 3's composed layers — same document Permissions reads
        ])
        // a failed layers fetch must never paint confident zeros (that's the
        // exact bug this page exists to fix) — abort and keep the last good
        // render, same as permissions/index.js's `if (!w.ok) return`
        if (!layers.ok) return toast(layers.error.code + ": " + (layers.error.message || "could not load shipped baselines"), "err")
        const roleRows = roles.ok ? roles.data : []
        const userRows = users.ok ? users.data : []
        const policyRows = policies.ok ? policies.data : []
        // read-only layers are the shipped baselines; mirrors permissions/index.js's `baseline`
        const baselinePolicies = (layers.data.layers ?? []).filter((l) => l.readonly).flatMap((l) => l.policies)

        // every name in play — a row, a policy annotation, or a holder makes a
        // role REAL; rows merely give it a description and a delete button
        const names = [...new Set([
            ...roleRows.map((r) => r.name),
            ...policyRows.flatMap((p) => rolesOf(p.roles)),
            ...baselinePolicies.flatMap((p) => p.roles ?? []),
            ...userRows.flatMap((u) => rolesOf(u.roles))
        ])].sort()

        c.$list.replaceChildren()
        if (!names.length) {
            const empty = document.createElement("div")
            empty.className = "nx-card"
            empty.innerHTML = '<p class="nx-muted">No roles yet. Create one above, then attach it to policies (Permissions) and users (Users).</p>'
            return c.$list.append(empty)
        }
        for (const name of names) {
            const row = roleRows.find((r) => r.name === name)
            const grantingDb = policyRows.filter((p) => rolesOf(p.roles).includes(name))
            const grantingBase = baselinePolicies.filter((p) => (p.roles ?? []).includes(name))
            const holders = userRows.filter((u) => rolesOf(u.roles).includes(name))

            const card = document.createElement("div")
            card.className = "nx-card"
            const head = document.createElement("div")
            head.className = "nx-head"
            head.style.marginBottom = "var(--sp-2)"
            const title = document.createElement("h3")
            title.style.margin = "0"
            title.style.fontFamily = "var(--mono)"
            title.textContent = name
            const spread = document.createElement("span")
            spread.className = "nx-spacer"
            head.append(title, spread)
            if (row) {
                const del = button({
                    variant: "danger", iconName: "trash", title: "Delete this role row",
                    onclick: async () => {
                        const refs = grantingDb.length + grantingBase.length + holders.length
                        const warning = refs
                            ? `"${name}" is still referenced by ${grantingDb.length + grantingBase.length} policy(ies) and ${holders.length} user(s) — they keep the name; it simply stops being a managed row. Delete?`
                            : `Delete role "${name}"?`
                        if (!(await confirmDialog(warning))) return
                        const r = await ctx.api.remove("nexus_role", row.id)
                        toast(r.ok ? "Role deleted" : r.error.code, r.ok ? "ok" : "err")
                        load()
                    }
                })
                head.append(del)
            } else {
                const adopt = button({
                    title: "This name exists only in policies/users — adopt it as a managed row",
                    onclick: async () => {
                        const r = await ctx.api.create("nexus_role", { name })
                        toast(r.ok ? "Adopted" : r.error.code, r.ok ? "ok" : "err")
                        load()
                    }
                }, ["Adopt"])
                head.append(adopt)
            }
            card.append(head)

            if (row?.description || !row) {
                const description = document.createElement("p")
                description.className = "nx-muted"
                description.style.marginTop = "0"
                description.textContent = row?.description || "(unmanaged name — seen in policies or users)"
                card.append(description)
            }

            const facts = document.createElement("div")
            facts.className = "nx-options"
            const fact = (textContent) => {
                const chip = document.createElement("span")
                chip.className = "nx-chip"
                chip.textContent = textContent
                return chip
            }
            facts.append(
                fact(`${grantingDb.length} live policies`),
                fact(`${grantingBase.length} shipped baselines`),
                fact(`${holders.length} users: ${holders.map((u) => u.name || u.pub).join(", ") || "—"}`)
            )
            card.append(facts)
            c.$list.append(card)
        }
    }
    load()

    // live refresh: coarse but truthful — re-run load() on any matching event
    let reloadTimer = null
    onUnmount(subscribe(["nexus_role", "nexus_policy"], () => {
        clearTimeout(reloadTimer)
        reloadTimer = setTimeout(load, 250) // collapse bursts into one reload
    }))
    // the burst-collapse timer is a route resource too — the old
    // isConnected pattern was subscription-shaped and could not reach it,
    // so a timer scheduled just before navigating still fired on a dead route
    onUnmount(() => clearTimeout(reloadTimer))
    return host
}
