/**
 * Theme controller — mode (auto/light/dark) via the data-theme attribute the
 * tokens listen to, and the ACCENT as hue/saturation channel overrides on
 * :root. Themes are numbers, not colors (the akao channel rule), so both
 * switches cost nothing but an attribute and two custom properties.
 */

const THEMES = ["auto", "light", "dark"]

/** The accent palette — channel pairs, limegreen first (the default). */
export const ACCENTS = [
    { name: "limegreen", h: 120, s: "61%" },
    { name: "amber", h: 41, s: "88%" },
    { name: "blue", h: 214, s: "72%" },
    { name: "violet", h: 262, s: "60%" },
    { name: "red", h: 4, s: "66%" },
    { name: "cyan", h: 187, s: "68%" }
]

export function createTheme() {
    let theme = localStorage.getItem("nexus-theme") || "auto"
    let accent = localStorage.getItem("nexus-accent") || ACCENTS[0].name
    const apply = () => {
        if (theme === "auto") document.documentElement.removeAttribute("data-theme")
        else document.documentElement.setAttribute("data-theme", theme)
        const a = ACCENTS.find((x) => x.name === accent) ?? ACCENTS[0]
        // the tokens compose --accent from these two channels — nothing else moves
        document.documentElement.style.setProperty("--h2", a.h)
        document.documentElement.style.setProperty("--s2", a.s)
    }
    apply()
    return {
        get value() { return theme },
        get accent() { return accent },
        icon: () => (theme === "dark" ? "moon" : theme === "light" ? "sun" : "circle-half"),
        set(mode) { theme = THEMES.includes(mode) ? mode : "auto"; localStorage.setItem("nexus-theme", theme); apply(); return theme },
        setAccent(name) { accent = ACCENTS.some((a) => a.name === name) ? name : ACCENTS[0].name; localStorage.setItem("nexus-accent", accent); apply(); return accent },
        cycle() { return this.set(THEMES[(THEMES.indexOf(theme) + 1) % 3]) }
    }
}

export default { createTheme, ACCENTS }
