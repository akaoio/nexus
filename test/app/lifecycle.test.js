/**
 * Entity lifecycle (LIFE-*) — the cascade DELETE plan: complete, pure, and
 * refused for system entities. The dry run IS the contract the executor
 * performs; nothing is destroyed that the plan did not name.
 */

import Test, { assert } from "../../src/core/Test.js"
import { entityDeletePlan } from "../../src/core/App/lifecycle.js"

const S = (schema, file) => ({ schema, file })
const SCHEMAS = [
    S({ name: "task", schemaVersion: 1, fields: [{ name: "title", type: "text" }] }, "apps/starter/models/task.json"),
    S({ name: "project", schemaVersion: 1, fields: [
        { name: "name", type: "text" },
        { name: "main_task", type: "link", target: "task" }
    ] }, "apps/starter/models/project.json"),
    S({ name: "note", schemaVersion: 1, fields: [{ name: "body", type: "text" }] }, "apps/starter/models/note.json")
]

Test.describe("Entity lifecycle (LIFE-*)", () => {
    Test.it("LIFE-01 the plan names EVERYTHING: rows, file, db policies, orphans, link drops, views, roles", () => {
        const plan = entityDeletePlan({
            target: "task",
            schemas: SCHEMAS,
            rowCount: 47,
            dbPolicyRows: [
                { id: "P1", entity: "task", roles: '["editor"]' },
                { id: "P2", entity: "note", roles: null }
            ],
            baselinePolicies: [{ entity: "task", source: "apps/starter/permissions/studio.json", roles: ["admin"] }],
            viewRows: [{ id: "V1", entity: "task" }, { id: "V2", entity: "note" }]
        })
        assert.equal(plan.rowCount, 47)
        assert.equal(plan.schemaFile, "apps/starter/models/task.json")
        assert.deepEqual(plan.dbPolicies, ["P1"])
        assert.deepEqual(plan.baselineOrphans, [{ source: "apps/starter/permissions/studio.json", roles: ["admin"] }])
        // `index` joined this shape with issue #9 I8: sqlite refuses to drop a
        // column an index still references, so a plan naming only the column
        // described work that could not actually be performed.
        assert.deepEqual(plan.linkDrops, [
            { entity: "project", field: "main_task", file: "apps/starter/models/project.json", index: "idx_project_main_task" }
        ])
        assert.deepEqual(plan.views, ["V1"])
        assert.deepEqual(plan.rolesAffected, ["admin", "editor"])
    })

    Test.it("LIFE-02 refusals are loud: system entities and unknown targets never plan", () => {
        assert.throws(() => entityDeletePlan({ target: "nexus_user", schemas: SCHEMAS }), "E_SYSTEM_ENTITY")
        assert.throws(() => entityDeletePlan({ target: "ghost", schemas: SCHEMAS }), "E_UNKNOWN_ENTITY")
    })

    Test.it("LIFE-03 an untouched entity plans clean — empty cascades, no invented work", () => {
        const plan = entityDeletePlan({ target: "note", schemas: SCHEMAS })
        assert.deepEqual(plan.linkDrops, [])
        assert.deepEqual(plan.dbPolicies, [])
        assert.deepEqual(plan.views, [])
        assert.deepEqual(plan.rolesAffected, [])
    })
})
