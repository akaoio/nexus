/**
 * UI engine façade — the template system extracted from akao src/core/UI.js.
 *
 * html()   — tagged template → TemplateResult (pure string work, isomorphic)
 * render() — TemplateResult → live DOM (browser only)
 * css()    — tagged template → <style> element (browser only)
 * Component — custom-element base class (browser only)
 *
 * No Virtual DOM, no diffing — direct DOM construction with comment markers
 * for dynamic values. Component state is States (one reactivity system, §3).
 */

export { html } from "./UI/html.js"
export { css } from "./UI/css.js"
export { render } from "./UI/render.js"
export { Component } from "./UI/Component.js"
