/**
 * Dev file watcher for HMR (design 2026-07-20 §3): maps changed paths to the
 * asset kinds HMR.js's apply() dispatches on, debounced per path. Node-only,
 * dev-only — production never imports this module.
 *
 * onChange payload: { dir, path, asset, timestamp } — `dir` is the exact
 * entry from `dirs` this watcher was created for (Node's fs.watch reports
 * `path` RELATIVE to that root, not to any shared ancestor), `path` is that
 * root-relative filename, `asset` is assetKind(path), `timestamp` is
 * Date.now() at debounce-fire time. devMessage() below turns this into the
 * actual dev-stream message, since only the caller knows which watched root
 * maps to which servable URL (or to none, for apps/).
 */

import { watch } from "fs"
import { existsSync } from "fs"

/** HMR.js's own dispatch law, as one pure function. */
export function assetKind(path) {
    const p = String(path).replaceAll("\\", "/")
    if (p.split("/").some((seg) => seg.startsWith("."))) return null // dotfiles/dirs
    if (p.endsWith(".css.js") || p.endsWith(".css")) return "css"
    if (p.endsWith("/template.js") || p === "template.js") return "template"
    if (p.endsWith(".js") || p.endsWith(".yaml")) return "js" // yaml (i18n) rides the js path → full swap/reload downstream
    // Model schemas are .json — the format the Studio itself writes — and this
    // returned null for them, so a model file appearing in apps/ was the one
    // change the watcher ignored completely. Not "js": JSON is data, not a
    // module to hot-swap, so it takes the reload path downstream.
    if (p.endsWith(".json")) return "data"
    return null
}

export function createWatcher({ dirs = [], onChange, debounceMs = 80 } = {}) {
    const watchers = []
    const timers = new Map()
    for (const dir of dirs) {
        if (!existsSync(dir)) continue
        try {
            const w = watch(dir, { recursive: true }, (_event, filename) => {
                if (!filename) return
                const asset = assetKind(filename)
                if (!asset) return
                clearTimeout(timers.get(filename))
                timers.set(filename, setTimeout(() => {
                    timers.delete(filename)
                    onChange({ dir, path: filename.replaceAll("\\", "/"), asset, timestamp: Date.now() })
                }, debounceMs))
            })
            w.on("error", (error) => console.warn(`hmr watcher (${dir}): ${error.message} — watching disabled for this dir`))
            watchers.push(w)
        } catch (error) {
            console.warn(`hmr watcher could not start on ${dir}: ${error.message}`)
        }
    }
    return {
        stop() {
            for (const t of timers.values()) clearTimeout(t)
            timers.clear()
            for (const w of watchers) try { w.close() } catch { /* closed */ }
            watchers.length = 0
        }
    }
}

/** Map a watch hit to the dev-stream message: framework dirs hot-swap via
 *  their servable /_nexus URLs; app dirs (not browser-served) full-reload. */
export function devMessage({ dir, path, asset, timestamp }, { nexusRoot, appsDir }) {
    const p = String(dir).replaceAll("\\", "/")
    const nr = String(nexusRoot).replaceAll("\\", "/")
    // Data is not swappable — a changed .json under the framework dirs means a
    // full reload, not a module hot-swap.
    if (asset === "data" && (p === nr + "/src/studio" || p === nr + "/src/core")) return "reload"
    if (p === nr + "/src/studio") return { type: "hmr", path: "/_nexus/src/studio/" + path, asset, timestamp }
    if (p === nr + "/src/core") return { type: "hmr", path: "/_nexus/src/core/" + path, asset, timestamp }
    if (p === String(appsDir).replaceAll("\\", "/")) return "reload"
    return null // unknown root — emit nothing
}

export default { assetKind, createWatcher, devMessage }
