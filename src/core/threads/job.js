/**
 * The JOB worker (design §3, the Launcher discipline): handlers NEVER run on
 * the main thread. Boot loads the apps' hooks.js right here — handler code
 * lives in the thread; functions never cross the message boundary. Data
 * access is ONLY the narrow plane-RPC (4 ops) to the "plane" pseudo-thread.
 */

import { pathToFileURL } from "url"
import { join } from "path"
import Thread from "../Thread.js"

class JobThread extends Thread {
    jobs = new Map()

    /**
     * Promisified narrow RPC to the main-side plane pseudo-thread.
     *
     * The NAME arrives in workerData because the registry is global and an
     * instance is not: two instances exist at once during every hot reload, and
     * a hardcoded "plane" meant the second binding silently replaced the first
     * while the first was still serving. This is the one place a name has to
     * cross the worker boundary, and changing only the main side of it is how
     * an earlier attempt broke the runner outright.
     */
    rpc(method, params) {
        if (!this.planeName) return Promise.reject(new Error("E_NO_PLANE: this job thread was started without a plane binding"))
        return new Promise((resolve, reject) => {
            this.queue({ thread: this.planeName, method, params, callback: (response, error) => (error ? reject(new Error(error.message ?? String(error))) : resolve(response)) })
        })
    }

    plane = {
        create: (entity, data) => this.rpc("create", { entity, data }),
        update: (entity, id, patch) => this.rpc("update", { entity, id, patch }),
        get: (entity, id) => this.rpc("get", { entity, id }),
        list: (entity, filter = null) => this.rpc("list", { entity, filter })
    }

    async init() {
        const { workerData } = await import("worker_threads")
        const { root, apps = [], builtins = [], config = {}, planeName = null } = workerData ?? {}
        this.planeName = planeName
        const noop = () => {}
        const registrar = {
            hook: noop,
            endpoint: noop,
            command: noop,
            // v1: handlers don't enqueue from inside a running job — enqueue
            // belongs to hooks/endpoints, which run on the main side.
            enqueue: () => { throw new Error("E_THREAD_ENQUEUE: enqueue jobs from hooks/endpoints, not from inside a handler") },
            job: (name, spec) => this.jobs.set(name, spec)
        }
        for (const url of builtins) (await import(url)).default?.(registrar, { config, root })
        for (const app of apps) {
            const path = join(root, "apps", app.dir, "hooks.js")
            try { (await import(pathToFileURL(path).href)).default?.(registrar) } catch { /* app without hooks.js */ }
        }
    }

    /**
     * Readiness, asked for explicitly by the main thread.
     *
     * `run()` already awaits `this.ready`, but that is too late for the CALLER:
     * the main side starts the execution timer when it hands the job over, so a
     * worker still loading its module graph and every app's hooks.js spends the
     * handler's whole budget booting (JOB-TIMEOUT-04).
     */
    async ping() {
        await this.ready
        return true
    }

    /** Invoked by the main thread per job: { id, name, payload }. */
    async run({ id, name, payload }) {
        await this.ready
        const spec = this.jobs.get(name)
        if (!spec) throw new Error(`E_HANDLER: "${name}" not registered in the job thread`)
        return await spec.run({ id, payload }, { plane: this.plane })
    }
}

new JobThread()
