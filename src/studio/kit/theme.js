/**
 * Theme controller — mode (auto/light/dark) via the data-theme attribute the
 * tokens listen to. Themes are numbers, not colors (the akao channel rule),
 * so switching costs nothing but an attribute.
 */

const THEMES = ["auto", "light", "dark"]

export function createTheme() {
    let theme = localStorage.getItem("nexus-theme") || "auto"
    const apply = () => {
        if (theme === "auto") document.documentElement.removeAttribute("data-theme")
        else document.documentElement.setAttribute("data-theme", theme)
    }
    apply()
    return {
        get value() { return theme },
        icon: () => (theme === "dark" ? "moon" : theme === "light" ? "sun" : "circle-half"),
        set(mode) { theme = THEMES.includes(mode) ? mode : "auto"; localStorage.setItem("nexus-theme", theme); apply(); return theme },
        cycle() { return this.set(THEMES[(THEMES.indexOf(theme) + 1) % 3]) }
    }
}

export default { createTheme }
