/**
 * How a field finds its editor — the rule, separated from the registry so it
 * can be asserted under Node (kit/fields.js reaches the component barrel and
 * therefore needs a document).
 *
 * ARCHITECTURE.md §7.1: "Thêm kiểu field = thêm một entry trong fields.js,
 * không viết UI riêng cho từng field/Entity." The registry stays keyed by TYPE.
 * `overrides` points ONE NAMED field at an interface that is itself registered
 * and reusable — it does not open a door to per-entity UI.
 *
 * It exists because `nexus_user.roles` is a `text` field holding JSON, and
 * Model Schema v1 is frozen (N4), so "give roles its own field type" is a
 * format version rather than an afternoon. Without the seam the users route
 * hand-built its entire form instead, which is how ~20 createElement calls of
 * UI no other entity could reach ended up living there.
 *
 * Per CALL, never global: overriding `roles` on the users page must not change
 * how a text field renders anywhere else.
 *
 * Falling back to `text` for an unknown type is deliberate — an entity carrying
 * a field type this Studio build predates must still be EDITABLE, not blank.
 */
export const resolveInterface = (field, registry, overrides = null) =>
    overrides?.[field.name] || registry[field.type] || registry.text

export default { resolveInterface }
