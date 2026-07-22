/**
 * Main-side of the job thread (design §3): spawn the worker, expose
 * execute(), and register the "plane" PSEUDO-THREAD — an object honoring
 * the Threads postMessage contract, so worker→main RPC rides the existing
 * message protocol with zero kernel changes. The RPC is the narrow seam:
 * four ops, one job-scoped ctx, never god-mode.
 */

import { randomKey } from "../Utils.js"
import { threads } from "../Threads.js"
import { LEASE_MS } from "./jobs.js"

/**
 * How long main waits for the worker before giving up on a job.
 *
 * DERIVED from the lease rather than restated, because the RELATION is the
 * invariant and the numbers are not. These two used to be equal, and at
 * equality there is no window in which the runner has given up but the lease
 * has not yet expired — so a second runner can claim a job the first is still
 * inside. Strictly shorter opens that window on purpose (JOB-TIMEOUT-02).
 */
export const EXEC_TIMEOUT_MS = Math.floor(LEASE_MS * 0.75)

/** Register (or replace) the narrow plane RPC under `ctx`. */
export function bindPlaneRpc(plane, ctx, planeName = "plane#" + randomKey()) {
    const ops = {
        create: ({ entity, data }) => plane.create(entity, data, ctx),
        update: ({ entity, id, patch }) => plane.update(entity, id, patch, ctx),
        get: ({ entity, id }) => plane.get(entity, id, ctx),
        list: ({ entity, filter }) => plane.list(entity, filter ? { filter } : {}, ctx)
    }
    threads.threads[planeName] = {
        postMessage: async ({ queue, method, params }) => {
            try {
                if (!ops[method]) throw new Error(`E_RPC: unknown op "${method}"`)
                const response = await ops[method](params ?? {})
                threads.process({ queue, response }, planeName)
            } catch (error) {
                threads.process({ queue, error: { message: String(error?.message ?? error) } }, planeName)
            }
        },
        removeAllListeners() {},
        terminate() {}
    }
    return { planeName }
}

/** Spawn the job worker; returns { execute, stop, running }. */
export async function startJobThread({
    root,
    apps = [],
    builtins = [],
    config = {},
    timeoutMs = EXEC_TIMEOUT_MS,
    startupMs = 15000,
    planeName = null
} = {}) {
    const url = new URL("../threads/job.js", import.meta.url)

    // A NAME OF ITS OWN, minted here rather than asked of a caller. `Threads`
    // keys by name and `register()` is a get-or-create, so a constant "job"
    // meant two live instances could not both have a worker — and `nexus dev`
    // makes two on purpose during every hot reload, since the rebuild happens
    // before the old instance is released. The second was handed the FIRST
    // one's worker (old apps, old config) and then lost it when the first was
    // released, leaving the running instance with no runner and nothing saying
    // so. A caller asked to invent a name is a caller that can forget, and
    // forgetting reproduces that in silence (THRNS-01).
    // No plane by default, rather than a name of our own. Two independent
    // defaults would have to AGREE, and a caller that forgot to pass the one
    // `bindPlaneRpc` returned would get a worker talking to a plane nobody
    // bound — the same silent mismatch this whole change exists to remove,
    // wearing new clothes. `null` makes "no plane" a stated fact the worker can
    // report on, instead of a name that happens not to resolve.
    const jobName = "job#" + randomKey()
    const spawn = () => threads.register(jobName, { worker: true, url, workerData: { root, apps, builtins, config, planeName } })
    await spawn()

    // Confirmed LAZILY, inside whichever call needs it, so no round-trip is
    // ever parked on the queue between jobs — an idle entry there reads exactly
    // like the abandoned one JOB-TIMEOUT-01 exists to catch, and an eager ping
    // made that clause fail.
    let confirmed = false
    const ensureReady = async () => {
        if (confirmed) return
        await new Promise((resolve, reject) => {
            const timer = setTimeout(() => reject(new Error("E_THREAD_START: the job worker did not come up")), startupMs)
            threads.queue({ thread: jobName, method: "ping", params: {}, callback: (_response, error) => {
                clearTimeout(timer)
                error ? reject(new Error(error.message ?? String(error))) : resolve()
            } })
        })
        confirmed = true
    }
    // A CONSTRUCTOR THAT THROWS MUST NOT LEAVE ITS RESOURCE BEHIND. The worker
    // is already spawned by this point, and on failure no rig is returned — so
    // nothing else could ever stop it. A live worker thread keeps the whole
    // Node process alive, which turns "startup failed" into "the process never
    // exits": the suite hung in CI rather than reporting anything.
    try {
        await ensureReady()
    } catch (error) {
        await threads.terminate(jobName)
        throw error
    }

    const execute = async ({ id, name, payload }) => {
        // A worker still importing its module graph is not the job's fault, and
        // the wait for it is NOT the handler's budget. Charging it there made a
        // cold start report E_TIMEOUT — "your handler hung" — which recycled the
        // worker again, so the next job was likely to do the same. One hung
        // handler could walk a queue of healthy jobs into the DLQ.
        await ensureReady()
        return new Promise((resolve, reject) => {
        let queue = null
        const timer = setTimeout(async () => {
            // Giving up is not enough (I6). The queue entry has to go, or it
            // leaks one per timed-out job — and the WORKER has to go, or the
            // hung handler keeps running and fires its side effect after main
            // has already settled this job as failed and scheduled a retry.
            // Reclaiming only the memory would leave the worse half in place.
            threads.cancel(queue)
            try {
                await threads.terminate(jobName)
                await spawn() // v1's pool is one thread: recycling IS the recovery
                confirmed = false // the replacement has not spoken yet
            } catch { /* the rejection below is the caller's answer either way */ }
            reject(new Error("E_TIMEOUT: job thread did not answer"))
        }, timeoutMs)
        queue = threads.queue({ thread: jobName, method: "run", params: { id, name, payload }, callback: (response, error) => {
            clearTimeout(timer)
            error ? reject(new Error(error.message ?? String(error))) : resolve(response)
        } })
        })
    }

    // Exactly its own two, so an instance released takes its threads with it
    // and nothing else's (THRNS-03).
    const stop = async () => { await threads.terminate(jobName); if (planeName) delete threads.threads[planeName] }
    /** Is a worker currently registered? (Observability for JOB-TIMEOUT-01.) */
    const running = () => Boolean(threads.threads[jobName])
    // `name` is exposed so a caller can find THIS rig's worker in the registry
    // rather than guessing a key — guessing a shared constant is the habit that
    // produced the defect above.
    return { execute, stop, running, name: jobName, planeName }
}

export default { bindPlaneRpc, startJobThread }
