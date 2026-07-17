/**
 * Global reactive state — one States instance shared across the entire app.
 *
 * Deliberately thin. akao's Context bundled theme/fiat/referrer logic coupled
 * to its Statics store and ZEN graph; those are APP concerns, not kernel ones
 * (principle N5) — a Nexus app (akao included, once it runs on Nexus) seeds
 * its own keys via Context.set() at construct time. The kernel only promises:
 * one global, reactive, empty-by-default States instance.
 */

import States from "./States.js"

export const Context = globalThis.Context instanceof States ? globalThis.Context : new States({})

globalThis.Context = Context

export default Context
