/**
 * Design tokens — the akao original system (pre-fork discipline, recovered
 * from akao@6d2d1fc5): colors are HSL CHANNELS (--h/--s/--l), never rgb/hex;
 * every size derives from --unit in rem — no px (the one sanctioned
 * exception: --border-width). Semantic names (--bg, --surface, --accent…)
 * are COMPOSITIONS of channels, so a theme is numbers, not colors:
 * dark mode flips lightness values and touches nothing else; a whitelabel
 * is a new --h2. Custom properties inherit into shadow roots — components
 * consume vars and never hardcode.
 *
 * Identity: amber (--h2: 41) on blue-slate (--h1: 216), mono voice for data.
 */

export const tokens = /* css */ `
:root {
    /* ── the unit — everything is rem, derived from here ── */
    --unit: 0.125rem;

    /* spacing scale */
    --sp-1: calc(var(--unit) * 2);
    --sp-2: calc(var(--unit) * 4);
    --sp-3: calc(var(--unit) * 6);
    --sp-4: calc(var(--unit) * 8);
    --sp-5: calc(var(--unit) * 12);
    --sp-6: calc(var(--unit) * 16);

    /* type scale */
    --text-xs: calc(var(--unit) * 5.5);
    --text-sm: calc(var(--unit) * 6.25);
    --text-md: calc(var(--unit) * 7);
    --text-lg: calc(var(--unit) * 8);
    --text-xl: calc(var(--unit) * 10);

    /* icon + control sizing — same-row elements share one height */
    --icon: calc(var(--unit) * 8);
    --icon-lg: calc(var(--unit) * 22);
    --control-h: calc(var(--unit) * 18);

    /* shape */
    --radius-sm: calc(var(--unit) * 3);
    --radius: calc(var(--unit) * 5);
    --border-width: 1px;

    /* motion */
    --speed: 160ms;
    --ease: var(--speed) cubic-bezier(.3, .7, .4, 1);

    /* fonts */
    --font: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;

    /* ── color channels (light) — themes flip NUMBERS, not colors ── */
    --h1: 216; --s1: 18%;                 /* base: blue-slate */
    --h2: 41;  --s2: 88%;                 /* accent: amber */
    --h-ok: 158; --s-ok: 55%;
    --h-danger: 0; --s-danger: 62%;

    --l-bg: 96.5%;
    --l-surface: 100%;
    --l-surface-2: 93.5%;
    --l-border: 88%;
    --l-text: 15%;
    --l-muted: 43%;
    --l-accent: 31%;
    --l-accent-fg: 100%;
    --l-ok: 30%;
    --l-danger: 49%;
    --a-shadow: 0.06;

    /* ── semantic compositions — the ONLY color forms components use ── */
    --bg: hsl(var(--h1) var(--s1) var(--l-bg));
    --surface: hsl(var(--h1) var(--s1) var(--l-surface));
    --surface-2: hsl(var(--h1) var(--s1) var(--l-surface-2));
    --border: hsl(var(--h1) var(--s1) var(--l-border));
    --text: hsl(var(--h1) var(--s1) var(--l-text));
    --muted: hsl(var(--h1) calc(var(--s1) * 0.6) var(--l-muted));
    --accent: hsl(var(--h2) var(--s2) var(--l-accent));
    --accent-fg: hsl(var(--h2) calc(var(--s2) * 0.3) var(--l-accent-fg));
    --accent-soft: color-mix(in hsl, var(--accent) 12%, transparent);
    --ok: hsl(var(--h-ok) var(--s-ok) var(--l-ok));
    --danger: hsl(var(--h-danger) var(--s-danger) var(--l-danger));
    --shadow: 0 var(--border-width) calc(var(--unit) * 1) hsl(var(--h1) 50% 8% / var(--a-shadow)),
              0 calc(var(--unit) * 4) calc(var(--unit) * 12) hsl(var(--h1) 50% 8% / var(--a-shadow));
}

/* dark — lightness numbers flip; hues and structure never change */
@media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
        --l-bg: 7.5%;
        --l-surface: 11.5%;
        --l-surface-2: 16%;
        --l-border: 22%;
        --l-text: 93%;
        --l-muted: 62%;
        --l-accent: 59%;
        --l-accent-fg: 8%;
        --l-ok: 62%;
        --l-danger: 70%;
        --a-shadow: 0.38;
    }
}
:root[data-theme="dark"] {
    --l-bg: 7.5%;
    --l-surface: 11.5%;
    --l-surface-2: 16%;
    --l-border: 22%;
    --l-text: 93%;
    --l-muted: 62%;
    --l-accent: 59%;
    --l-accent-fg: 8%;
    --l-ok: 62%;
    --l-danger: 70%;
    --a-shadow: 0.38;
}
@media (prefers-reduced-motion: reduce) {
    :root { --speed: 0ms; }
}
`

export default tokens
