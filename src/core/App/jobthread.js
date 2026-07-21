/**
 * Main-side of the job thread (design §3): spawn the worker, expose
 * execute(), and register the "plane" PSEUDO-THREAD — an object honoring
 * the Threads postMessage contract, so worker→main RPC rides the existing
 * message protocol with zero kernel changes. The RPC is the narrow seam:
 * four ops, one job-scoped ctx, never god-mode.
 */

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
export function bindPlaneRpc(plane, ctx) {
    const ops = {
        create: ({ entity, data }) => plane.create(entity, data, ctx),
        update: ({ entity, id, patch }) => plane.update(entity, id, patch, ctx),
        get: ({ entity, id }) => plane.get(entity, id, ctx),
        list: ({ entity, filter }) => plane.list(entity, filter ? { filter } : {}, ctx)
    }
    threads.threads["plane"] = {
        postMessage: async ({ queue, method, params }) => {
            try {
                if (!ops[method]) throw new Error(`E_RPC: unknown op "${method}"`)
                const response = await ops[method](params ?? {})
                threads.process({ queue, response }, "plane")
            } catch (error) {
                threads.process({ queue, error: { message: String(error?.message ?? error) } }, "plane")
            }
        },
        removeAllListeners() {},
        terminate() {}
    }
}

/** Spawn the job worker; returns { execute, stop, running }. */
export async function startJobThread({ root, apps = [], builtins = [], config = {}, timeoutMs = EXEC_TIMEOUT_MS } = {}) {
    const url = new URL("../threads/job.js", import.meta.url)
    const spawn = () => threads.register("job", { worker: true, url, workerData: { root, apps, builtins, config } })
    await spawn()

    const execute = ({ id, name, payload }) => new Promise((resolve, reject) => {
        let queue = null
        const timer = setTimeout(async () => {
            // Giving up is not enough (I6). The queue entry has to go, or it
            // leaks one per timed-out job — and the WORKER has to go, or the
            // hung handler keeps running and fires its side effect after main
            // has already settled this job as failed and scheduled a retry.
            // Reclaiming only the memory would leave the worse half in place.
            threads.cancel(queue)
            try {
                await threads.terminate("job")
                await spawn() // v1's pool is one thread: recycling IS the recovery
            } catch { /* the rejection below is the caller's answer either way */ }
            reject(new Error("E_TIMEOUT: job thread did not answer"))
        }, timeoutMs)
        queue = threads.queue({ thread: "job", method: "run", params: { id, name, payload }, callback: (response, error) => {
            clearTimeout(timer)
            error ? reject(new Error(error.message ?? String(error))) : resolve(response)
        } })
    })

    const stop = async () => { await threads.terminate("job"); delete threads.threads["plane"] }
    /** Is a worker currently registered? (Observability for JOB-TIMEOUT-01.) */
    const running = () => Boolean(threads.threads["job"])
    return { execute, stop, running }
}

export default { bindPlaneRpc, startJobThread }
