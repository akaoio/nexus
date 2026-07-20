/**
 * System entities — "everything is an Entity" (the Frappe lesson: User,
 * Role and the permission rows are ordinary documents; even DocType is a
 * DocType). Here: nexus_user, nexus_role, nexus_policy and nexus_view are
 * builtin Model Schema v1 documents that run the SAME pipeline as any app
 * entity — validate, DDL, permission, search. Nothing here is a special
 * code path; what makes them "system" is only this registry's flag: the
 * Studio may edit their ROWS but never their structure, and never delete
 * them. nexus_entity is the meta view (schemas stay FILES — git is the
 * source of truth; its write adapter lives with the dev server).
 *
 * Browser-loadable on purpose: the Studio imports isSystem() and the
 * pack/unpack halves; nothing here touches fs or process.
 */

import { viewSchema } from "../Views.js"
import { validatePolicy } from "./policies.js"

/** JSON-in-text columns (the nexus_view.config precedent): arrays and rule
 *  documents ride as serialized text — the schema stays v1-plain. */
const J = (value) => JSON.stringify(value)

const USER = Object.freeze({
    schemaVersion: 1,
    name: "nexus_user",
    label: { en: "User", vi: "Người dùng" },
    fields: [
        { name: "pub", type: "text", required: true, unique: true, label: { en: "Public key", vi: "Khóa công khai" } },
        { name: "name", type: "text", label: { en: "Name", vi: "Tên" } },
        { name: "email", type: "text", label: { en: "Email", vi: "Email" } },
        { name: "avatar", type: "text", label: { en: "Avatar", vi: "Ảnh đại diện" } },
        { name: "bio", type: "text", label: { en: "Bio", vi: "Giới thiệu" } },
        { name: "locale", type: "text", label: { en: "Locale", vi: "Ngôn ngữ" } },
        // many roles per user (Frappe Has Role) — a JSON array of role names
        // permlevel 1: self-service (permlevel 0) must never write its own roles —
        // that path was a two-request escalation to admin (issue #9 C1)
        { name: "roles", type: "text", permlevel: 1, label: { en: "Roles", vi: "Vai trò" } }
    ]
})

const ROLE = Object.freeze({
    schemaVersion: 1,
    name: "nexus_role",
    label: { en: "Role", vi: "Vai trò" },
    fields: [
        { name: "name", type: "text", required: true, unique: true, label: { en: "Name", vi: "Tên" } },
        { name: "description", type: "text", label: { en: "Description", vi: "Mô tả" } }
    ]
})

// GET /api/v1/_policy-layers authorizes with DataPlane.access (ROW scope only —
// allowed && filter === null) and hands back full rows with no field-level cut.
// Harmless while every field here sits at permlevel 0; the day one of these
// fields gets a permlevel (nexus_user.roles, on ITS OWN schema, shows what
// that looks like — not a field this route exposes), that route starts
// leaking it to permlevel-0 readers. Route and schema must move together.
const POLICY = Object.freeze({
    schemaVersion: 1,
    name: "nexus_policy",
    label: { en: "Policy", vi: "Chính sách" },
    fields: [
        { name: "entity", type: "text", required: true, label: { en: "Entity", vi: "Thực thể" } },
        { name: "actions", type: "text", required: true, label: { en: "Actions", vi: "Hành động" } },
        { name: "rule", type: "text", label: { en: "Rule", vi: "Điều kiện" } },
        { name: "permlevel", type: "integer", default: 0, label: { en: "Permlevel" } },
        { name: "ifowner", type: "boolean", default: false, label: { en: "Owner only", vi: "Chỉ chủ sở hữu" } },
        { name: "roles", type: "text", label: { en: "Roles", vi: "Vai trò" } },
        { name: "description", type: "text", label: { en: "Description", vi: "Mô tả" } }
    ]
})

const JOB = Object.freeze({
    schemaVersion: 1,
    name: "nexus_job",
    label: { en: "Job", vi: "Tác vụ" },
    fields: [
        { name: "name", type: "text", required: true, label: { en: "Handler", vi: "Trình xử lý" } },
        { name: "payload", type: "text", label: { en: "Payload" } },
        { name: "status", type: "select", options: ["pending", "running", "done", "failed", "dead"], default: "pending", label: { en: "Status", vi: "Trạng thái" } },
        { name: "run_at", type: "datetime", label: { en: "Run at", vi: "Chạy lúc" } },
        { name: "every_ms", type: "integer", label: { en: "Every (ms)" } },
        { name: "attempts", type: "integer", default: 0, label: { en: "Attempts" } },
        { name: "max_attempts", type: "integer", default: 5, label: { en: "Max attempts" } },
        { name: "lease_until", type: "datetime", label: { en: "Lease until" } },
        { name: "lease_token", type: "text", label: { en: "Lease token" } },
        { name: "last_error", type: "text", label: { en: "Last error", vi: "Lỗi cuối" } },
        { name: "result", type: "text", label: { en: "Result", vi: "Kết quả" } }
    ]
})

const WEBHOOK = Object.freeze({
    schemaVersion: 1,
    name: "nexus_webhook",
    label: { en: "Webhook" },
    fields: [
        { name: "url", type: "text", required: true, label: { en: "URL" } },
        { name: "entity", type: "text", label: { en: "Entity", vi: "Thực thể" } },
        { name: "events", type: "text", label: { en: "Events (JSON)" } },
        { name: "secret", type: "text", label: { en: "Secret" } },
        { name: "enabled", type: "boolean", default: true, label: { en: "Enabled", vi: "Bật" } },
        { name: "description", type: "text", label: { en: "Description", vi: "Mô tả" } }
    ]
})

const NOTIFICATION = Object.freeze({
    schemaVersion: 1,
    name: "nexus_notification",
    label: { en: "Notification", vi: "Thông báo" },
    fields: [
        { name: "user", type: "text", required: true, label: { en: "User (pub)" } },
        { name: "title", type: "text", required: true, label: { en: "Title", vi: "Tiêu đề" } },
        { name: "body", type: "text", label: { en: "Body", vi: "Nội dung" } },
        { name: "href", type: "text", label: { en: "Link" } },
        { name: "read", type: "boolean", default: false, label: { en: "Read", vi: "Đã đọc" } }
    ]
})

/** The builtin schemas — every one a valid Model Schema v1 document. */
export const SYSTEM_ENTITIES = Object.freeze([USER, ROLE, POLICY, viewSchema(), JOB, WEBHOOK, NOTIFICATION])

const SYSTEM_NAMES = new Set([...SYSTEM_ENTITIES.map((s) => s.name), "nexus_entity"])

/** Is this entity system-owned? (undeletable, structure frozen in Studio) */
export const isSystem = (name) => SYSTEM_NAMES.has(name)

// ─── policy rows ⇄ Permission v1 policy objects ───────────────────────────────

/** A Permission policy object → a nexus_policy row's data columns. */
export function packPolicy(policy) {
    return {
        entity: policy.entity,
        actions: J(policy.actions ?? []),
        rule: policy.rule == null ? null : J(policy.rule),
        permlevel: policy.permlevel ?? 0,
        ifowner: policy.ifOwner === true,
        roles: policy.roles == null ? null : J(policy.roles),
        description: policy.description ?? null
    }
}

/** A nexus_policy row → the Permission policy object the engine consumes. */
export function unpackPolicy(row) {
    const policy = {
        entity: row.entity,
        actions: row.actions ? JSON.parse(row.actions) : [],
        permlevel: row.permlevel ?? 0,
        ifOwner: row.ifowner === true || row.ifowner === 1,
        rule: row.rule ? JSON.parse(row.rule) : null
    }
    if (row.roles) policy.roles = JSON.parse(row.roles)
    if (row.description) policy.description = row.description
    return policy
}

/**
 * Validate a nexus_policy ROW's data columns as the policy it will become.
 * The write-side defense (design 2026-07-19 §3): the same law binds the
 * Studio and any direct API caller. Unparseable JSON columns are E_POLICY.
 */
export function validatePolicyRow(data, schemas = null) {
    let policy
    try {
        policy = unpackPolicy(data)
    } catch {
        return { valid: false, errors: [{ code: "E_POLICY" }] }
    }
    return validatePolicy(policy, schemas)
}

/**
 * Unpack nexus_policy rows TOLERANTLY (design §3 read-side defense): a
 * corrupt row is collected, never thrown — one bad row must never take
 * down the auth layer. Each unpacked policy carries its row id.
 */
export function unpackPolicyRows(rows) {
    const policies = []
    const skipped = []
    for (const row of rows ?? []) {
        try {
            policies.push({ id: row.id, ...unpackPolicy(row) })
        } catch (error) {
            skipped.push({ id: row?.id, error: String(error?.message ?? error) })
        }
    }
    return { policies, skipped }
}

// ─── shipped baselines — self-service as DATA, never an if-admin branch ───────

/** Lifecycle actions the admin bundle grants on system entities. */
const ADMIN_ACTIONS = Object.freeze(["read", "write", "create", "delete"])

/**
 * The policies NEXUS itself ships (source "nexus", read-only like an app
 * baseline): the `admin` role owns every system entity; every
 * AUTHENTICATED user may read the role registry and directory, and write
 * exactly their own nexus_user row — the $CURRENT_USER rule the engine
 * already resolves. Who may edit whom is all here, all data.
 */
export const SYSTEM_BASELINES = Object.freeze([
    ...["nexus_user", "nexus_role", "nexus_policy", "nexus_view", "nexus_job", "nexus_webhook", "nexus_notification"].map((entity) =>
        Object.freeze({ entity, actions: ADMIN_ACTIONS, rule: null, permlevel: 0, ifOwner: false, roles: ["admin"] })),
    // admin manages roles: field-level grant at permlevel 1 (document access
    // comes from the permlevel-0 admin bundle above)
    Object.freeze({ entity: "nexus_user", actions: ADMIN_ACTIONS, rule: null, permlevel: 1, ifOwner: false, roles: ["admin"] }),
    // the directory: any signed-in user can see who exists and which roles exist
    Object.freeze({ entity: "nexus_user", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }),
    Object.freeze({ entity: "nexus_role", actions: ["read"], rule: null, permlevel: 0, ifOwner: false }),
    // self-service: your own profile row is yours to edit
    Object.freeze({
        entity: "nexus_user", actions: ["write"], permlevel: 0, ifOwner: false,
        rule: { astVersion: 1, root: { field: "pub", operator: "eq", value: "$CURRENT_USER" } }
    }),
    // saved views are personal: create your own, touch only your own
    Object.freeze({ entity: "nexus_view", actions: ["read", "write", "create", "delete"], rule: null, permlevel: 0, ifOwner: true })
])

/**
 * The admin bundle over the WHOLE instance — Frappe's System Manager,
 * expressed as generated policy DATA: one full-access policy per loaded
 * schema, role-gated to `admin`. Generated at boot from the live schema
 * list, so a hot-added entity is covered the moment it exists; the engine
 * itself never learns a wildcard.
 * @param {Array} schemas - every schema the instance serves (apps + system)
 */
export function adminBaselines(schemas = []) {
    return schemas.map((schema) => ({
        entity: schema.name, actions: ADMIN_ACTIONS, rule: null, permlevel: 0, ifOwner: false, roles: ["admin"]
    }))
}

// ─── bootstrap ────────────────────────────────────────────────────────────────

/**
 * Map nexus.config.json identities to nexus_user row data (one-way, first
 * boot only — after this, the table IS the directory and config identities
 * remain merely a login fallback so an admin can never lock themselves out).
 */
export function importIdentities(identities = []) {
    return (identities ?? []).map((identity) => ({
        pub: identity.pub,
        name: identity.name || identity.pub,
        roles: J(identity.roles ?? [])
    }))
}

/** Effect entities never sync: replication ≠ work distribution — a job row
 *  replayed on every peer is an effect executed N times (design §6). */
export const SERVER_ONLY = Object.freeze(["nexus_job", "nexus_webhook"])
export const isServerOnly = (name) => SERVER_ONLY.includes(name)

export default { SYSTEM_ENTITIES, SYSTEM_BASELINES, adminBaselines, isSystem, packPolicy, unpackPolicy, validatePolicyRow, unpackPolicyRows, importIdentities, SERVER_ONLY, isServerOnly }
