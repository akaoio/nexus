/**
 * Studio kit — the shared NON-UI primitives: the authenticated API client,
 * the i18n data store (text renders through <nx-context>, never a t() call), the
 * theme controller, and thin seams over the UI primitives (toast → the
 * <nx-notifications> host, confirmDialog → an <nx-modal>). DOM structure
 * lives in templates and components — never built ad-hoc here.
 */

import NxContext from "../components/context/index.js"
import NxNotifications from "../components/notifications/index.js"
import "../components/modal/index.js"
import "../components/button/index.js"

// ── component factories (instantiation, the akao `new ITEM()` way) ─────────────
/** A Bootstrap icon element (<nx-icon>) — THE way to show an icon, never emoji. */
export const icon = (name) => {
    const node = document.createElement("nx-icon")
    node.setAttribute("name", name)
    return node
}

/** A dictionary-bound text element (<nx-context>) — THE way to show a UI string. */
export const text = (key, fallback, args) => {
    const node = document.createElement("nx-context")
    node.dataset.key = key
    if (fallback != null) node.dataset.fallback = fallback
    if (args != null) node.dataset.args = JSON.stringify(args)
    return node
}

/** A button primitive (<nx-button>). */
export const button = ({ variant, iconName, disabled, title, onclick } = {}, children = []) => {
    const node = document.createElement("nx-button")
    if (variant) node.dataset.variant = variant
    if (iconName) node.dataset.icon = iconName
    if (disabled) node.setAttribute("disabled", "")
    if (title) node.title = title
    if (onclick) node.addEventListener("click", onclick)
    for (const child of [].concat(children)) if (child != null) node.append(typeof child === "string" ? document.createTextNode(child) : child)
    return node
}

// ── template mounting (routes/layouts render their template.js with this) ──────
import { render } from "../../core/UI.js"

/** Render a kernel html\`\` template into a fresh host element. */
export function mountTemplate(template, tag = "div") {
    const host = document.createElement(tag)
    render(template, host)
    return host
}

// ── notifications ──────────────────────────────────────────────────────────────
/** Non-blocking toast through the <nx-notifications> primitive. */
export function toast(message, type = "ok") {
    NxNotifications.instance.push(message, type)
}

// ── confirm (replaces window.confirm) ──────────────────────────────────────────
/** A modal confirmation — resolves true/false. Message may be a string or node. */
export function confirmDialog(message) {
    return new Promise((resolve) => {
        const modal = document.createElement("nx-modal")
        modal.dataset.header = "confirm"
        const body = document.createElement("div")
        body.style.display = "grid"
        body.style.gap = "var(--sp-3)"
        const text = document.createElement("p")
        text.style.margin = "0"
        text.append(typeof message === "string" ? document.createTextNode(message) : message)
        const actions = document.createElement("div")
        actions.style.display = "flex"
        actions.style.gap = "var(--sp-2)"
        actions.style.justifyContent = "flex-end"
        let verdict = false
        const done = (value) => {
            verdict = value
            modal.close()
        }
        actions.append(
            button({ onclick: () => done(false) }, [text("cancel")]),
            button({ variant: "primary", onclick: () => done(true) }, [text("confirm")])
        )
        body.append(text, actions)
        modal.append(body)
        modal.addEventListener("close", () => {
            modal.remove()
            resolve(verdict)
        })
        document.body.append(modal)
        modal.showModal()
    })
}

// ── the split kit — api / i18n / theme live in their own files; this index
// is the kit's public surface (the component-index rule applied to machinery)
export { createApi } from "./api.js"
export { createI18n } from "./i18n.js"
export { createTheme } from "./theme.js"
export { subscribe } from "./events.js"
export { onUnmount } from "./lifecycle.js"
export { buildForm, interfaces, interfaceFor, editableFields, control, fieldWrap, labelledField } from "./fields.js"
export { parseTags, serializeTags } from "./tags.js"
