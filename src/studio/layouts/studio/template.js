/**
 * The Studio layout templates — STRUCTURE only, declarative (akao layouts
 * pattern): the shell (topbar/side/main), the drawer and the login panel.
 * Text is dictionary-bound through <nx-context>; icons are <nx-icon>; the top-bar
 * widgets (badge, locale select, theme button) arrive as slots from the
 * composition root.
 */

import { html } from "../../../core/UI.js"
import "../../components/icon/index.js"
import "../../components/context/index.js"
import "../../components/button/index.js"
import "../../components/navigator/index.js"
import "../../components/user/index.js"

export const layoutTemplate = (c, { site, badge }) => html`
    <div class="nx-app" ${({ element }) => (c.app = element)}>
        <header class="nx-top">
            <nx-button data-variant="icon" class="nx-hamb" data-icon="list"
                ${({ element }) => element.addEventListener("click", () => c.app.classList.toggle("open"))}></nx-button>
            <span class="nx-brand">
                <span class="hex"><nx-icon name="hexagon"></nx-icon></span>
                ${site}
                <small>Studio</small>
            </span>
            <span class="nx-spacer"></span>
            <span ${({ element }) => element.replaceWith(badge)}></span>
            <nx-user ${({ element }) => (c.user = element)}></nx-user>
        </header>
        <div class="nx-scrim" ${({ element }) => element.addEventListener("click", () => c.app.classList.remove("open"))}></div>
        <aside class="nx-side">
            <div class="nx-grouplabel"><nx-context data-key="collections"></nx-context></div>
            <nav class="nx-nav" id="nx-nav-ent" ${({ element }) => (c.entNav = element)}></nav>
            <div class="nx-grouplabel"><nx-context data-key="build"></nx-context></div>
            <nav class="nx-nav" id="nx-nav" ${({ element }) => (c.nav = element)}></nav>
        </aside>
        <main class="nx-main" id="nx-main" ${({ element }) => (c.main = element)}></main>
        <span class="nx-orbit">
            <nx-navigator>
                <nx-navigator data-icon="translate" ${({ element }) => (c.localesNav = element)}></nx-navigator>
                <nx-navigator data-icon="circle-half" ${({ element }) => (c.themesNav = element)}></nx-navigator>
            </nx-navigator>
        </span>
    </div>
`

export const drawerTemplate = (c) => html`
    <div class="nx-drawer" id="nx-drawer" ${({ element }) => (c.drawer = element)}>
        <div class="nx-drawer-back" ${({ element }) => element.addEventListener("click", () => c.closeDrawer())}></div>
        <div class="nx-drawer-panel">
            <h2 id="nx-drawer-title" ${({ element }) => (c.drawerTitle = element)}></h2>
            <div id="nx-drawer-slot" ${({ element }) => (c.drawerSlot = element)}></div>
        </div>
    </div>
`

export const loginTemplate = (c, { site, onSubmit, onPasskey }) => html`
    <div class="nx-login" id="nx-login" hidden ${({ element }) => (c.login = element)}>
        <div class="nx-card" style="width:min(94vw,23.75rem)">
            <h2 style="margin:0 0 0.25rem;display:flex;gap:0.375rem;align-items:center">
                <span style="color:var(--accent);display:inline-flex"><nx-icon name="hexagon"></nx-icon></span>
                ${site}
            </h2>
            <p class="nx-muted"><nx-context data-key="login" data-fallback="Sign in"></nx-context></p>
            <div class="nx-field">
                <label class="nx-label">Passphrase</label>
                <input id="nx-pass" class="nx-input" type="password" placeholder="your secret passphrase"
                    ${({ element }) => {
                        c.pass = element
                        element.addEventListener("keydown", (e) => { if (e.key === "Enter") onSubmit(c.pass.value, c.loginErr) })
                    }}>
            </div>
            <div class="nx-actions">
                <nx-button data-variant="primary" style="flex:1"
                    ${({ element }) => element.addEventListener("click", () => onSubmit(c.pass.value, c.loginErr))}>
                    <nx-context data-key="login" data-fallback="Sign in"></nx-context>
                </nx-button>
            </div>
            <div class="nx-actions" hidden ${({ element }) => (c.passkeyRow = element)}>
                <nx-button style="flex:1" data-icon="shield-lock"
                    ${({ element }) => element.addEventListener("click", () => onPasskey(c.loginErr))}>
                    Unlock with passkey
                </nx-button>
            </div>
            <div class="nx-err" id="nx-login-err" ${({ element }) => (c.loginErr = element)}></div>
            <p class="nx-muted" style="font-size:var(--text-sm)">
                Your passphrase derives a ZEN keypair in this browser — no password is sent.
                An admin must add your public key first.
            </p>
        </div>
    </div>
`

export default { layoutTemplate, drawerTemplate, loginTemplate }
