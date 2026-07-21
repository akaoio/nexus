/** /jobs route — the DLQ front and center (design §7): nexus_job rows
 *  grouped by status, Retry = an ordinary entity-API update. */

import { mountTemplate, button, toast, subscribe, onUnmount } from "../../kit/index.js"
import { jobsTemplate } from "./template.js"

const GROUPS = ["dead", "failed", "running", "pending", "done"]

export function render(ctx) {
    const c = {}
    const host = mountTemplate(jobsTemplate(c))

    async function load() {
        const r = await ctx.api.list("nexus_job", null)
        const rows = r.ok ? r.data : []
        c.$body.replaceChildren()
        for (const status of GROUPS) {
            const bucket = rows.filter((x) => x.status === status)
            if (!bucket.length) continue
            const h = document.createElement("h3")
            h.textContent = `${status} · ${bucket.length}`
            c.$body.append(h)
            for (const row of bucket) {
                const line = document.createElement("div")
                line.className = "nx-row"
                const who = document.createElement("div")
                who.className = "nx-who"
                const name = document.createElement("div")
                name.textContent = row.name
                const detail = document.createElement("div")
                detail.className = "nx-pub"
                detail.textContent = [`attempts ${row.attempts}/${row.max_attempts}`, row.run_at && `runs ${row.run_at}`, row.last_error].filter(Boolean).join(" · ")
                who.append(name, detail)
                line.append(who)
                if (status === "dead" || status === "failed") {
                    line.append(button({
                        onclick: async () => {
                            const res = await ctx.api.update("nexus_job", row.id, { status: "pending", attempts: 0, lease_until: null, lease_token: null, last_error: null })
                            toast(res.ok ? "Requeued" : res.error.code, res.ok ? "ok" : "err")
                            load()
                        }
                    }, ["Retry"]))
                }
                c.$body.append(line)
            }
        }
        if (!rows.length) {
            const none = document.createElement("p")
            none.className = "nx-muted"
            none.textContent = "No jobs yet — enqueue from a hook or endpoint with enqueue(name, payload)."
            c.$body.append(none)
        }
    }
    load()

    // live refresh: coarse but truthful — re-run load() on any matching event
    let reloadTimer = null
    onUnmount(subscribe(["nexus_job"], () => {
        clearTimeout(reloadTimer)
        reloadTimer = setTimeout(load, 250) // collapse bursts into one reload
    }))
    // the burst-collapse timer is a route resource too — the old
    // isConnected pattern was subscription-shaped and could not reach it,
    // so a timer scheduled just before navigating still fired on a dead route
    onUnmount(() => clearTimeout(reloadTimer))
    return host
}
