/**
 * The Studio layout — logic side of the triad: renders the templates
 * (template.js) and exposes refs + drawer behavior. No ad-hoc DOM building;
 * structure lives in the template, styles in styles.css.js.
 */

import { render } from "../../../kernel/UI.js"
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
export function buildLayout({ site, badge }) {
    const c = {}
    c.closeDrawer = () => c.drawer.classList.remove("show")
    mount(layoutTemplate(c, { site, badge }))
    mount(drawerTemplate(c))

    function openDrawer(title, node) {
        c.drawerTitle.textContent = title
        c.drawerSlot.replaceChildren(node)
        c.drawer.classList.add("show")
        c.drawerSlot.querySelector("input, select, textarea, button, nx-button")?.focus?.()
    }

    return { app: c.app, main: c.main, nav: c.nav, entNav: c.entNav, drawer: c.drawer, openDrawer, closeDrawer: c.closeDrawer }
}

/** The sign-in panel (ZEN passphrase → keypair; no password ever sent). */
export function buildLogin({ site, onSubmit }) {
    const c = {}
    mount(loginTemplate(c, { site, onSubmit }))
    return c.login
}

export default { buildLayout, buildLogin }
