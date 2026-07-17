/**
 * The Studio layout — builds the shell chrome (topbar, sidebar, main, drawer,
 * login) and owns its stylesheet. The app (app/app.js) supplies behavior:
 * navigation, auth, modules. akao layouts pattern: structure + styles here,
 * logic in the composition root.
 */

import { el, icon } from "../../app/lib.js"

/**
 * Build the shell. `slots` carries the variable pieces; behavior is wired by
 * the caller through the returned refs.
 * @returns {{ app, main, nav, entNav, drawer, login, openDrawer, closeDrawer }}
 */
export function buildLayout({ site, badge, localeSel, themeBtn, labels }) {
    const main = el("main", { class: "nx-main", id: "nx-main" })
    const nav = el("nav", { class: "nx-nav", id: "nx-nav" })
    const entNav = el("nav", { class: "nx-nav", id: "nx-nav-ent" })

    const app = el("div", { class: "nx-app", id: "nx-app" }, [
        el("header", { class: "nx-top" }, [
            el("button", { class: "nx-btn icon nx-hamb", title: labels.menu ?? "Menu", onclick: () => app.classList.toggle("open") }, [icon("list")]),
            el("span", { class: "nx-brand" }, [el("span", { class: "hex" }, [icon("hexagon")]), document.createTextNode(" " + site + " "), el("small", { text: "Studio" })]),
            el("span", { class: "nx-spacer" }),
            badge, localeSel, themeBtn
        ]),
        el("div", { class: "nx-scrim", onclick: () => app.classList.remove("open") }),
        el("aside", { class: "nx-side" }, [
            el("div", { class: "nx-grouplabel", text: labels.collections }),
            entNav,
            el("div", { class: "nx-grouplabel", text: labels.build }),
            nav
        ]),
        main
    ])

    const drawer = el("div", { class: "nx-drawer", id: "nx-drawer" }, [
        el("div", { class: "nx-drawer-back", onclick: () => closeDrawer() }),
        el("div", { class: "nx-drawer-panel" }, [el("h2", { id: "nx-drawer-title" }), el("div", { id: "nx-drawer-slot" })])
    ])

    function openDrawer(title, node) {
        drawer.querySelector("#nx-drawer-title").textContent = title
        drawer.querySelector("#nx-drawer-slot").replaceChildren(node)
        drawer.classList.add("show")
        drawer.querySelector("input, select, textarea, button")?.focus?.()
    }
    function closeDrawer() {
        drawer.classList.remove("show")
    }

    return { app, main, nav, entNav, drawer, openDrawer, closeDrawer }
}

/** The sign-in panel (ZEN passphrase → keypair; no password ever sent). */
export function buildLogin({ site, onSubmit }) {
    const err = el("div", { class: "nx-err", id: "nx-login-err" })
    const pass = el("input", {
        id: "nx-pass", class: "nx-input", type: "password", placeholder: "your secret passphrase",
        onkeydown: (e) => { if (e.key === "Enter") onSubmit(pass.value, err) }
    })
    const login = el("div", { class: "nx-login", id: "nx-login", hidden: true }, [
        el("div", { class: "nx-card", style: "width:min(94vw,380px)" }, [
            el("h2", { style: "margin:0 0 0.25rem;display:flex;gap:0.375rem;align-items:center" }, [el("span", { style: "color:var(--accent);display:inline-flex" }, [icon("hexagon")]), document.createTextNode(site)]),
            el("p", { class: "nx-muted", text: "Sign in" }),
            el("div", { class: "nx-field" }, [el("label", { class: "nx-label", text: "Passphrase" }), pass]),
            el("div", { class: "nx-actions" }, [el("button", { class: "nx-btn primary", style: "flex:1", text: "Sign in", onclick: () => onSubmit(pass.value, err) })]),
            err,
            el("p", { class: "nx-muted", style: "font-size:var(--text-sm)", text: "Your passphrase derives a ZEN keypair in this browser — no password is sent. An admin must add your public key first." })
        ])
    ])
    return login
}

export default { buildLayout, buildLogin }
