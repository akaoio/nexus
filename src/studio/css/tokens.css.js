/**
 * Design tokens — the single source of every color, size and rhythm in Studio
 * (akao css/vars pattern: tokens are data, components consume variables).
 *
 * Identity: "the hexagonal workbench" — ⬡ amber on blue-slate, and a MONO
 * VOICE for everything that is data (ids, keys, values, scores). Light and
 * dark are first-class; custom properties inherit into shadow roots, so
 * components never redeclare them.
 */

export const tokens = /* css */ `
:root {
    /* rhythm — 4px base */
    --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px; --sp-5: 24px; --sp-6: 32px;
    /* type */
    --font: system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, "Cascadia Code", "SF Mono", Menlo, Consolas, monospace;
    --text-xs: 11px; --text-sm: 12.5px; --text-md: 14px; --text-lg: 16px; --text-xl: 20px;
    /* shape */
    --radius-sm: 6px; --radius: 10px;
    /* motion */
    --ease: 160ms cubic-bezier(.3, .7, .4, 1);

    /* palette — light */
    --bg: #f5f6f8;
    --surface: #ffffff;
    --surface-2: #edf0f4;
    --border: #dce2ea;
    --text: #1b2433;
    --muted: #5b6a7e;
    --accent: #966a06;
    --accent-fg: #ffffff;
    --accent-soft: rgba(150, 106, 6, 0.11);
    --ok: #177a4c;
    --danger: #c23636;
    --shadow: 0 1px 2px rgba(27, 36, 51, 0.05), 0 8px 24px rgba(27, 36, 51, 0.07);
}
@media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
        --bg: #0d1219;
        --surface: #141b26;
        --surface-2: #1c2534;
        --border: #263140;
        --text: #e7ecf3;
        --muted: #8b9aad;
        --accent: #f2b63c;
        --accent-fg: #191001;
        --accent-soft: rgba(242, 182, 60, 0.13);
        --ok: #3fce8e;
        --danger: #f37272;
        --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
    }
}
:root[data-theme="dark"] {
    --bg: #0d1219;
    --surface: #141b26;
    --surface-2: #1c2534;
    --border: #263140;
    --text: #e7ecf3;
    --muted: #8b9aad;
    --accent: #f2b63c;
    --accent-fg: #191001;
    --accent-soft: rgba(242, 182, 60, 0.13);
    --ok: #3fce8e;
    --danger: #f37272;
    --shadow: 0 1px 2px rgba(0, 0, 0, 0.4), 0 8px 24px rgba(0, 0, 0, 0.35);
}
@media (prefers-reduced-motion: reduce) {
    :root { --ease: 0ms linear; }
}
`

export default tokens
