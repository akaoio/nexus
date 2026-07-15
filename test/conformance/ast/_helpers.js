/**
 * Shared helpers for Query AST conformance suites: document builders,
 * a seeded PRNG, and generators for property-based clauses.
 * Zero dependencies. These helpers are test infrastructure, not spec.
 */

// ─── Document builders ────────────────────────────────────────────────────────

/** Wrap a root node in a v1 AST document envelope. */
export const doc = (root = null) => ({ astVersion: 1, root })

/** Leaf node. Pass `value` as undefined for isnull/notnull. */
export const leaf = (field, operator, value) =>
    value === undefined ? { field, operator } : { field, operator, value }

export const and = (...children) => ({ op: "and", children })
export const or = (...children) => ({ op: "or", children })
export const not = (child) => ({ op: "not", children: [child] })

/** True if a validate() result contains an error with the given code. */
export const hasError = (result, code) =>
    result?.valid === false && result.errors?.some((e) => e.code === code)

/** Filter a dataset through a compiled predicate. */
export const filter = (predicate, rows) => rows.filter((row) => predicate(row))

// ─── Seeded PRNG (mulberry32) — deterministic property-based tests ───────────

export function prng(seed) {
    let a = seed >>> 0
    return function () {
        a |= 0
        a = (a + 0x6d2b79f5) | 0
        let t = Math.imul(a ^ (a >>> 15), 1 | a)
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296
    }
}

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)]
const int = (rnd, min, max) => min + Math.floor(rnd() * (max - min + 1))

// ─── Random AST generator ─────────────────────────────────────────────────────

const FIELDS = ["tier", "age", "active", "name", "score"]
const STRINGS = ["gold", "silver", "bronze", "alice", "bob", ""]

/** Generate a random valid leaf node over the fixture row shape. */
function randomLeaf(rnd) {
    const kind = pick(rnd, ["str_eq", "num_cmp", "bool", "in", "like", "null"])
    switch (kind) {
        case "str_eq":
            return leaf(pick(rnd, ["tier", "name"]), pick(rnd, ["eq", "ne"]), pick(rnd, STRINGS))
        case "num_cmp":
            return leaf(pick(rnd, ["age", "score"]), pick(rnd, ["gt", "gte", "lt", "lte", "eq", "ne"]), int(rnd, 0, 100))
        case "bool":
            return leaf("active", "eq", rnd() < 0.5)
        case "in":
            return leaf("tier", pick(rnd, ["in", "nin"]), [pick(rnd, STRINGS), pick(rnd, STRINGS)])
        case "like":
            return leaf("name", pick(rnd, ["like", "nlike"]), pick(rnd, ["%a%", "b%", "%e", "_ob"]))
        case "null":
            return leaf(pick(rnd, FIELDS), pick(rnd, ["isnull", "notnull"]))
    }
}

/** Generate a random valid node up to `depth` levels of logic nesting. */
export function randomNode(rnd, depth = 4) {
    if (depth <= 0 || rnd() < 0.4) return randomLeaf(rnd)
    const kind = pick(rnd, ["and", "or", "not"])
    if (kind === "not") return not(randomNode(rnd, depth - 1))
    const n = int(rnd, 1, 3)
    const children = []
    for (let i = 0; i < n; i++) children.push(randomNode(rnd, depth - 1))
    return { op: kind, children }
}

/** Generate a random row matching the fixture shape (some fields may be null/missing). */
export function randomRow(rnd) {
    const row = {}
    if (rnd() < 0.9) row.tier = pick(rnd, STRINGS)
    if (rnd() < 0.9) row.age = int(rnd, 0, 100)
    if (rnd() < 0.9) row.active = rnd() < 0.5
    if (rnd() < 0.8) row.name = pick(rnd, STRINGS)
    if (rnd() < 0.5) row.score = rnd() < 0.3 ? null : int(rnd, 0, 100)
    return row
}

// ─── Fixture dataset used across operator/permission clauses ─────────────────

export const ROWS = [
    { id: 1, tier: "gold", age: 30, active: true, name: "alice", owner: "u1", score: 10 },
    { id: 2, tier: "silver", age: 45, active: false, name: "bob", owner: "u2", score: null },
    { id: 3, tier: "bronze", age: 18, active: true, name: "carol", owner: "u1" },
    { id: 4, tier: null, age: null, active: null, name: null, owner: "u3", score: 0 },
    { id: 5, tier: "gold", age: 60, active: true, name: "dave", owner: "u2", score: 99 }
]
