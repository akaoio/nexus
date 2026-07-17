/**
 * <nx-navigator> styles — the akao original, VERBATIM (only design tokens and
 * the icon element are swapped to Nexus's: --background→--surface,
 * --color→--text, `border: var(--border)`→a real hairline, ui-icon→nx-icon).
 * The mechanics — orbit trigonometry, the recenter transform, the hamburger→X
 * morph, the ::slotted positioning — are unchanged from the source.
 */

import { css } from "../../../kernel/UI/css.js"

export const STYLE = () => css`
    :host {
        --icon: var(--icon-lg);
        --size: var(--icon);
        --step: calc(var(--size) * 1.5);
        --level: 0;
        --active: -1;
        --rad: calc(var(--step) * (var(--active) - var(--level) + 1));
        --center: calc(50svmin - var(--size) * 0.5);
        --transition: var(--speed) cubic-bezier(0, -2, 1, 2);
        display: flex;
        justify-content: center;
        align-items: center;
        width: var(--size);
        aspect-ratio: 1 / 1;
        border-radius: 50%;

        nav {
            display: flex;
            align-items: center;
            justify-content: center;
            transition: var(--transition);
            width: var(--size);
            aspect-ratio: 1 / 1;
            border-radius: 50%;

            &:has(#state:checked) {
                transform: translate(calc(var(--x, 0px) * -1), calc(var(--y, var(--center)) * -1));
                #orbit {
                    width: calc(var(--rad, 0px) * 2);
                    opacity: 1;
                }
            }

            #orbit {
                border-radius: 50%;
                border: var(--border-width, 1px) solid var(--border);
                position: absolute;
                aspect-ratio: 1 / 1;
                width: 0px;
                opacity: 0;
                transition: var(--transition);
            }

            #toggle {
                background: var(--surface);
                &:hover {
                    background: var(--surface-2);
                    span {
                        background: var(--accent);
                    }
                }
                transition: var(--transition);
                width: var(--size);
                height: var(--size);
                border-radius: 50%;
                display: flex;
                flex-direction: column;
                justify-content: center;
                align-items: center;
                cursor: pointer;
                position: absolute;
                z-index: calc(var(--level) - var(--active));
                box-shadow: var(--shadow);
                nx-icon {
                    &:not([name]) {
                        display: none;
                    }
                    color: var(--muted);
                    position: absolute;
                    display: flex;
                    pointer-events: auto;
                    border-radius: 50%;
                    transition: var(--transition);
                }

                nx-icon:active,
                div {
                    pointer-events: none;
                }

                div {
                    width: 50%;
                    aspect-ratio: 1 / 1;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    position: relative;
                    span {
                        position: absolute;
                        height: 1px !important;
                        width: 100%;
                        transition: var(--transition);
                        background: var(--text);
                        &:nth-child(1) {
                            transform: translateY(calc(var(--size) * 0.15));
                        }
                        &:nth-child(3) {
                            transform: translateY(calc(var(--size) * -0.15));
                        }
                    }
                }
            }

            #state {
                appearance: none;
                display: none;

                /* On active */
                &:checked {
                    & ~ #toggle {
                        nx-icon {
                            transform: translate(var(--x, 0px), var(--y, var(--center)));
                        }
                        span {
                            display: flex;
                            &:nth-child(1) {
                                transform: translateY(0) rotate(45deg);
                            }
                            &:nth-child(2) {
                                opacity: 0;
                            }
                            &:nth-child(3) {
                                transform: translateY(0) rotate(-45deg);
                            }
                        }
                    }

                    & ~ section {
                        slot {
                            opacity: 1;
                            --tmp-level: var(--level);
                            --tmp-rad: var(--rad);
                            --tmp-active: var(--active);
                            --tmp-total: var(--total, 0);
                            &::slotted(*) {
                                border: var(--border-width, 1px) solid var(--border);
                                opacity: 1;
                                --deg: calc(360deg / var(--tmp-total) * (var(--i, 0) - 1));
                                --x: calc(sin(var(--deg)) * var(--tmp-rad));
                                --y: calc(cos(var(--deg)) * var(--tmp-rad) * -1);
                                --level: calc(var(--tmp-level) + 1);
                                --active: var(--tmp-active);
                                transform: translate(var(--x), var(--y));
                            }
                        }
                    }
                }
            }

            section {
                aspect-ratio: 1 / 1;
                display: flex;
                align-items: center;
                justify-content: center;
                position: fixed;

                slot {
                    display: flex;
                    align-items: center;
                    opacity: 0;
                    width: var(--size);
                    aspect-ratio: 1 / 1;
                    position: absolute;
                    transition: var(--transition);
                    border-radius: 50%;
                    &::slotted(*) {
                        opacity: 0;
                        background: var(--surface);
                        box-shadow: var(--shadow);
                        position: absolute;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        transition: var(--transition);
                        border-radius: 50%;
                    }
                }
            }
        }
    }
`

export default STYLE
