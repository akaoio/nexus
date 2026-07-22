/**
 * Reading a backup incrementally — BREAD-*.
 *
 * Backup writes in pages of 500; restore opened the same file with
 * readFileSync + JSON.parse, so its peak cost was the whole document twice
 * over. The asymmetry was invisible because it works on every backup anyone
 * tests with — a backup large enough to be worth having was exactly the one
 * that could not be restored.
 *
 * Incremental readers fail at CHUNK BOUNDARIES: a split inside a string, right
 * after a backslash, in the middle of a number, between a key and its colon. A
 * 64 KiB read boundary lands wherever it lands. So the clause that carries the
 * most weight here (BREAD-02) feeds the same document one character at a time
 * and demands identical events — if that holds for every one-byte split, it
 * holds for every split.
 */

import Test, { assert } from "../../src/core/Test.js"
import { createBackupScanner, valueEnd } from "../../src/core/App/backup-read.js"

/** Every event a scanner produces for `text`, written in `size`-char chunks. */
function scan(text, size = Infinity) {
    const scanner = createBackupScanner()
    const events = []
    if (size === Infinity) events.push(...scanner.write(text))
    else for (let i = 0; i < text.length; i += size) events.push(...scanner.write(text.slice(i, i + size)))
    events.push(...scanner.end())
    return events
}

const DOC = JSON.stringify(
    {
        backupVersion: 1,
        createdAt: "2026-07-22T00:00:00.000Z",
        engine: "sqlite",
        secretsRedacted: true,
        apps: { starter: { "models/task.json": '{"name":"task"}' } },
        data: {
            task: [
                { id: "a", title: "first", done: 0 },
                { id: "b", title: "second", done: 1 }
            ],
            note: [{ id: "n", body: "only" }]
        },
        migrations: [{ id: "m1", entity: "task", checksum: "x", applied_at: "2026-01-01" }]
    },
    null,
    4
)

Test.describe("Backup incremental read (BREAD)", () => {
    Test.it("BREAD-01 a whole document yields its header, entities and rows in order", () => {
        const events = scan(DOC)

        const headers = events.filter((e) => e.type === "header")
        assert.equal(headers.find((h) => h.key === "backupVersion").value, 1)
        assert.equal(headers.find((h) => h.key === "secretsRedacted").value, true)
        assert.deepEqual(headers.find((h) => h.key === "apps").value, { starter: { "models/task.json": '{"name":"task"}' } })
        assert.equal(headers.find((h) => h.key === "migrations").value.length, 1)

        assert.deepEqual(events.filter((e) => e.type === "entity").map((e) => e.name), ["task", "note"])
        const rows = events.filter((e) => e.type === "row")
        assert.equal(rows.length, 3)
        assert.equal(rows[0].entity, "task")
        assert.equal(rows[0].row.title, "first")
        assert.equal(rows[2].entity, "note")

        // The array's own close is an event, so a caller can report per-entity
        // counts without keeping the rows to count them.
        const ends = events.filter((e) => e.type === "entityEnd")
        assert.deepEqual(ends.map((e) => [e.name, e.rows]), [["task", 2], ["note", 1]])
    })

    Test.it("BREAD-02 the SAME document written ONE CHARACTER AT A TIME yields identical events", () => {
        // The clause that matters most. A split can land anywhere — inside a
        // string, right after a backslash, between a key and its colon — and
        // this covers every one of those positions at once.
        assert.deepEqual(scan(DOC, 1), scan(DOC))

        // …and at a handful of other sizes, including ones that are not
        // divisors of anything in the document.
        for (const size of [2, 3, 7, 13, 64, 1024]) assert.deepEqual(scan(DOC, size), scan(DOC), `chunk size ${size}`)
    })

    Test.it("BREAD-03 strings holding braces, brackets, quotes and escapes do not confuse value boundaries", () => {
        // This is the entire reason the scanner cannot be a bracket count.
        const nasty = {
            backupVersion: 1,
            data: {
                task: [
                    { id: "a", title: 'a { brace } and a [ bracket ]' },
                    { id: "b", title: 'an escaped quote \\" and a trailing backslash \\\\' },
                    { id: "c", title: '}]},{[' , note: "unicode:    ☃" },
                    { id: "d", nested: { deep: [{ deeper: '"' }] } }
                ]
            }
        }
        const text = JSON.stringify(nasty)
        const rows = scan(text).filter((e) => e.type === "row").map((e) => e.row)
        assert.deepEqual(rows, nasty.data.task)

        // And identically when split at every position.
        assert.deepEqual(scan(text, 1), scan(text))

        // The primitive itself, on the cases that break bracket counting.
        assert.equal(valueEnd('{"a":"}"}', 0), 9)
        assert.equal(valueEnd('"a \\" b" rest', 0), 8)
        assert.equal(valueEnd('{"a":1}', 0), 7)
        assert.equal(valueEnd('{"a":', 0), -1) // incomplete — never guess
    })

    Test.it("BREAD-04 a TRUNCATED document throws rather than reporting a partial success", () => {
        // A restore that silently applies the first half of a backup is worse
        // than one that fails.
        const cut = DOC.slice(0, Math.floor(DOC.length * 0.6))
        assert.throws(() => scan(cut), "truncated")

        // Cut mid-row, mid-string, and immediately after the opening brace.
        assert.throws(() => scan('{"backupVersion":1,"data":{"task":[{"id":"a"'), "truncated")
        assert.throws(() => scan('{"backupVersion":1,"data":{"task":[{"id":"a b'), "truncated")
        assert.throws(() => scan("{"), "truncated")

        // Trailing content after the object is refused too — two concatenated
        // backups are not one backup.
        assert.throws(() => scan(DOC + DOC), "trailing")
    })

    Test.it("BREAD-05 an empty entity array and an empty data object need no special-casing", () => {
        const empty = scan('{"backupVersion":1,"data":{"task":[],"note":[]},"migrations":[]}')
        assert.deepEqual(empty.filter((e) => e.type === "entity").map((e) => e.name), ["task", "note"])
        assert.equal(empty.filter((e) => e.type === "row").length, 0)
        assert.deepEqual(empty.filter((e) => e.type === "entityEnd").map((e) => e.rows), [0, 0])

        const noData = scan('{"backupVersion":1,"data":{},"migrations":[]}')
        assert.equal(noData.filter((e) => e.type === "entity").length, 0)
        assert.equal(noData.find((e) => e.key === "backupVersion").value, 1)

        // Whitespace-heavy formatting (what backup actually writes) is fine.
        const spaced = scan('{\n  "backupVersion" : 1 ,\n  "data" : {\n    "task" : [\n      {"id":"a"}\n    ]\n  }\n}\n')
        assert.equal(spaced.filter((e) => e.type === "row").length, 1)
    })
})
