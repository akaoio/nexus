/**
 * Dev file watcher for HMR (design 2026-07-20 §3): maps changed paths to the
 * asset kinds HMR.js's apply() dispatches on, debounced per path. Node-only,
 * dev-only — production never imports this module.
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
                    onChange({ path: filename.replaceAll("\\", "/"), asset, timestamp: Date.now() })
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

export default { assetKind, createWatcher }
