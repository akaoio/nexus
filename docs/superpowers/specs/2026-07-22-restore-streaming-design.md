# `nexus site restore` reads incrementally — design

**Date:** 2026-07-22
**Source:** STATUS — *"**Backup streams; RESTORE still does not.** … `restore` still `JSON.parse`s the entire document, so restoring a multi-gigabyte backup will still exhaust memory. The failure issue #9 named was on the write side and that is what closed; the read side needs an incremental JSON reader, which is a genuinely larger piece of work and was not smuggled in."*

**Baseline:** 757/807 node · 50/50 browser · 9/9 e2e · 0 red.

**The sentence this chunk is accountable to:** *restoring a backup costs one row, not one database.*

---

## 0. The shape of the problem

Backup writes in pages of 500 and its peak cost is a page. Restore opens the same file with `readFileSync` + `JSON.parse`, so its peak cost is the whole document **twice over** — once as a UTF-8 buffer, once as the parsed object graph. A backup large enough to be worth having is exactly the one that cannot be restored.

The round trip is asymmetric in the way that matters least visibly: it works on every backup anyone tests with.

## 1. What actually needs to stream

The document has three regions and only one of them is unbounded:

| Region | Bound |
|---|---|
| header (`backupVersion`, `createdAt`, `engine`, `secretsRedacted`) | scalars |
| `apps` | the instance's own source files |
| `data.<entity>[]` | **every row in the database** |
| `migrations` | one entry per applied migration |

So `data` is what streams, and the rest is parsed whole. Claiming "restore streams" without that distinction would overstate it: an instance with a pathological `apps` tree still pays for `apps`. Said here rather than discovered later.

## 2. A scanner, not a parser

A general streaming JSON parser is a larger and riskier thing than this needs. What restore needs is narrower: walk the top-level object, and for `data`, hand back **one row at a time**. Leaf values are still parsed by `JSON.parse` — on a slice covering exactly one value — so no hand-written number, escape, or unicode handling can be subtly wrong.

That reduces the hand-written part to one job: **find where a JSON value ends**, which needs only depth tracking that is aware of strings and their escapes. Roughly eighty lines instead of several hundred, and the part most likely to be wrong is the part we did not write.

`src/core/App/backup-read.js` — DOM-free and stream-free, taking strings and returning events, so every case is a Node clause:

```js
const scanner = createBackupScanner()
scanner.write(chunk) // → [{type:"header",…}, {type:"entity",name}, {type:"row",entity,row}, …]
scanner.end()        // → remaining events; throws on a truncated document
```

The stream plumbing stays in the command, where it belongs.

## 3. The property worth pinning hardest

Incremental parsers fail at **chunk boundaries** — a split inside a string, immediately after a backslash, in the middle of a number, between a key and its colon. Those are not exotic; a 64 KiB read boundary lands wherever it lands.

So the clause that matters most feeds the same document **one character at a time** and asserts the events are identical to a single-shot write. If that holds for every one-byte split, it holds for every split.

A truncated document must **throw**, not return what it managed to read. A restore that silently applies the first half of a backup is worse than one that fails.

## 4. Restore keeps every behaviour it had

Streaming changes when rows arrive, not what happens to them. Additive-by-id, fit-to-destination-schema, never overwrite, preview without `--apply`, redaction warning, the migration ledger merge — all unchanged, and the existing clauses stay as they are. The only visible difference is that the report is built as rows go by rather than after everything is in memory.

One thing does improve: an existence check per row was already a query per row, so the streaming loop is not slower — but rows are now inserted as they are read, so a `--apply` on a large backup makes progress instead of doing nothing until the end.

## 5. Clauses

| Clause | Pins |
|---|---|
| `BREAD-01` | a whole document written at once yields header, entities, and rows in order |
| `BREAD-02` | the SAME document written one character at a time yields byte-identical events |
| `BREAD-03` | strings containing `{`, `[`, `"`, and escapes do not confuse value boundaries |
| `BREAD-04` | a truncated document THROWS at `end()` rather than reporting a partial success |
| `BREAD-05` | an empty entity array, and an empty `data` object, are handled without special-casing by the caller |
| `SITE-STREAM-03` | `restore` never holds the whole document: peak memory over a large backup is bounded |
| `SITE-ROUNDTRIP` | backup → restore of a real instance is unchanged end to end |
