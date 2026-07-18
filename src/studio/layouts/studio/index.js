/**
 * The Studio layout — logic side of the triad: renders the templates
 * (template.js) and exposes refs + drawer behavior. No ad-hoc DOM building;
 * structure lives in the template, styles in styles.css.js.
 */

import { render } from "../../../core/UI.js"
import { layoutTemplate, drawerTemplate, loginTemplate } from "./template.js"

/** Render a template into a detached container and hand back its refs. */
function mount(template) {
    const container = document.createElement("div")
    render(template, container)
    return container.firstElementChild
}

/**
 * Build the shell. Top-bar widgets arrive as slots; behavior is wired by the
 * caller through the returned refs.
 * @returns {{ app, main, nav, entNav, drawer, openDrawer, closeDrawer }}
 */
export function buildLayout({ site }) {
    const c = {}
    c.closeDrawer = () => c.drawer.classList.remove("show")
    mount(layoutTemplate(c, { site }))
    mount(drawerTemplate(c))

    function openDrawer(title, node) {
        c.drawerTitle.textContent = title
        c.drawerSlot.replaceChildren(node)
        c.drawer.classList.add("show")
        c.drawerSlot.querySelector("input, select, textarea, button, nx-button")?.focus?.()
    }

    return { app: c.app, main: c.main, nav: c.nav, entNav: c.entNav, drawer: c.drawer, user: c.user, navToggle: c.navToggle, searchToggle: c.searchToggle, searchbar: c.searchbar, openDrawer, closeDrawer: c.closeDrawer }
}

/** The sign-in panel (ZEN passphrase → keypair; no password ever sent). */
export function buildLogin({ site, onSubmit, onPasskey }) {
    const c = {}
    mount(loginTemplate(c, { site, onSubmit, onPasskey }))
    return { login: c.login, passkeyRow: c.passkeyRow }
}

export default { buildLayout, buildLogin }
