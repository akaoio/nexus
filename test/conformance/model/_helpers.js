/**
 * Shared helpers for Model Schema conformance suites. Test infrastructure,
 * not spec.
 */

/** A field definition. */
export const field = (name, type, props = {}) => ({ name, type, ...props })

/** A valid baseline schema; pass overrides to mutate the envelope. */
export const schema = (over = {}) => ({
    schemaVersion: 1,
    name: "customer",
    fields: [
        field("full_name", "text", { required: true }),
        field("tier", "select", { options: ["bronze", "silver", "gold"] }),
        field("age", "integer"),
        field("active", "boolean"),
        field("manager", "link", { target: "user" }),
        field("contacts", "table", { target: "customer_contact" })
    ],
    ...over
})

/** True if a validate() result contains an error with the given code. */
export const hasError = (result, code) =>
    result?.valid === false && result.errors?.some((e) => e.code === code)

/** Find the diff entry for a named field. */
export const changeFor = (changes, fieldName) => changes.find((c) => c.field === fieldName)
