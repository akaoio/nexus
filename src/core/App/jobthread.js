/**
 * Main-side of the job thread (design §3): spawn the worker, expose
 * execute(), and register the "plane" PSEUDO-THREAD — an object honoring
 * the Threads postMessage contract, so worker→main RPC rides the existing
 * message protocol with zero kernel changes. The RPC is the narrow seam:
 * four ops, one job-scoped ctx, never god-mode.
 */

import { threads } from "../Threads.js"

const EXEC_TIMEOUT_MS = 60000

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

/** Spawn the job worker; returns { execute, stop }. */
export async function startJobThread({ root, apps = [], builtins = [], config = {} } = {}) {
    const url = new URL("../threads/job.js", import.meta.url)
    await threads.register("job", { worker: true, url, workerData: { root, apps, builtins, config } })
    const execute = ({ id, name, payload }) => new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("E_TIMEOUT: job thread did not answer")), EXEC_TIMEOUT_MS)
        threads.queue({ thread: "job", method: "run", params: { id, name, payload }, callback: (response, error) => {
            clearTimeout(timer)
            error ? reject(new Error(error.message ?? String(error))) : resolve(response)
        } })
    })
    const stop = async () => { await threads.terminate("job"); delete threads.threads["plane"] }
    return { execute, stop }
}

export default { bindPlaneRpc, startJobThread }
