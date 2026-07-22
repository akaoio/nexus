/**
 * Reading a backup incrementally — the read half of §4.4's round trip.
 *
 * `nexus site backup` writes in pages of 500, so its peak cost is a page.
 * `restore` used to open the same file with readFileSync + JSON.parse, so its
 * peak cost was the whole document TWICE: once as a UTF-8 buffer, once as the
 * parsed object graph. A backup large enough to be worth having was exactly
 * the one that could not be restored — and the asymmetry was invisible because
 * it works on every backup anyone tests with.
 *
 * WHAT STREAMS, PRECISELY. The document has three regions and only one is
 * unbounded: the header is scalars, `apps` is the instance's own source files,
 * `migrations` is one entry per applied migration, and `data.<entity>[]` is
 * every row in the database. So `data` streams and the rest is parsed whole.
 * An instance with a pathological apps/ tree still pays for apps/; saying
 * "restore streams" without that distinction would overstate it.
 *
 * A SCANNER, NOT A PARSER. A general streaming JSON parser is a larger and
 * riskier thing than this needs. The hand-written part here does exactly one
 * job — find where a JSON value ENDS, which needs depth tracking that is aware
 * of strings and their escapes — and then hands the slice to JSON.parse. So no
 * hand-rolled number, escape or unicode handling can be subtly wrong: the part
 * most likely to be wrong is the part we did not write.
 *
 * DOM-free and stream-free on purpose: strings in, events out. Every case —
 * including a document fed one character at a time, which is where incremental
 * readers actually break — is reachable from a Node clause with no I/O.
 */

/**
 * Find the end of the JSON value starting at `from` in `text`.
 *
 * @returns the index one past the value's last character, or -1 when the text
 *          runs out first (meaning: need more input, do not guess).
 *
 * Strings are tracked because a `{` inside `"a { b"` is not a nesting level,
 * and escapes are tracked because the `"` in `"a \" b"` does not end it. Those
 * two are the whole reason this cannot be a bracket count.
 */
export function valueEnd(text, from) {
    let i = from
    const first = text[i]
    if (first === undefined) return -1

    // A scalar: number, true, false, null. It ends at the first character that
    // cannot continue one — which the caller's structure then interprets.
    if (first !== "{" && first !== "[" && first !== '"') {
        while (i < text.length && !",}] \t\n\r".includes(text[i])) i++
        // Ran to the end of the buffer without a terminator: the value may
        // continue in the next chunk (a number split across a boundary).
        return i < text.length ? i : -1
    }

    let depth = 0
    let inString = false
    let escaped = false
    for (; i < text.length; i++) {
        const c = text[i]
        if (escaped) {
            escaped = false
            continue
        }
        if (c === "\\") {
            if (inString) escaped = true
            continue
        }
        if (c === '"') {
            inString = !inString
            if (!inString && depth === 0) return i + 1 // a bare string value
            continue
        }
        if (inString) continue
        if (c === "{" || c === "[") depth++
        else if (c === "}" || c === "]") {
            depth--
            if (depth === 0) return i + 1
        }
    }
    return -1
}

const WS = " \t\n\r"

/**
 * An incremental reader over a backup document.
 *
 * Events, in the order the document produces them:
 *   { type: "header", key, value }        one per top-level key that is not `data`
 *   { type: "entity", name }              a data entity's array has opened
 *   { type: "row", entity, row }          one row
 *   { type: "entityEnd", name, rows }     that entity's array has closed
 *
 * `end()` returns any trailing events and THROWS on a truncated document. A
 * restore that silently applies the first half of a backup is worse than one
 * that fails.
 */
export function createBackupScanner() {
    let buf = ""
    let consumed = 0 // characters dropped from the front of buf, for compaction
    let state = "start" // start → topKey → topValue → (dataKey → rows) → done
    let pendingKey = null
    let entity = null
    let entityRows = 0
    let finished = false

    const skipWs = (i) => {
        while (i < buf.length && WS.includes(buf[i])) i++
        return i
    }

    /**
     * Consume as much of the buffer as is currently complete.
     * Returns the events produced. Never throws on a short read — that is what
     * `end()` is for.
     */
    function drain() {
        const events = []
        let i = 0

        for (;;) {
            i = skipWs(i)
            if (i >= buf.length) break

            if (state === "start") {
                if (buf[i] !== "{") throw new SyntaxError("a backup must be a JSON object")
                i++
                state = "topKey"
                continue
            }

            if (state === "done") break

            if (state === "topKey") {
                if (buf[i] === ",") { i++; continue }
                if (buf[i] === "}") { i++; state = "done"; continue }
                if (buf[i] !== '"') throw new SyntaxError(`expected a key at ${consumed + i}, found ${JSON.stringify(buf[i])}`)
                // REWIND ON A SHORT READ. Everything below advances `i`, and
                // whatever `i` has passed is dropped from the buffer when the
                // loop exits — so waiting for more input after consuming the
                // key would discard the key and leave the next chunk starting
                // at ":". Found by BREAD-02 on its first run, which is what a
                // one-character-at-a-time clause is for.
                const keyStart = i
                const keyEnd = valueEnd(buf, i)
                if (keyEnd === -1) break // the key itself is split across chunks
                const key = JSON.parse(buf.slice(i, keyEnd))
                i = skipWs(keyEnd)
                if (i >= buf.length) { i = keyStart; break }
                if (buf[i] !== ":") throw new SyntaxError(`expected ':' after ${JSON.stringify(key)}`)
                pendingKey = key
                i++
                state = pendingKey === "data" ? "dataOpen" : "topValue"
                continue
            }

            if (state === "topValue") {
                const end = valueEnd(buf, i)
                if (end === -1) break // incomplete — wait for more input
                events.push({ type: "header", key: pendingKey, value: JSON.parse(buf.slice(i, end)) })
                i = end
                pendingKey = null
                state = "topKey"
                continue
            }

            if (state === "dataOpen") {
                if (buf[i] !== "{") throw new SyntaxError('"data" must be an object of entity → rows')
                i++
                state = "dataKey"
                continue
            }

            if (state === "dataKey") {
                if (buf[i] === ",") { i++; continue }
                if (buf[i] === "}") { i++; state = "topKey"; continue } // data closed
                if (buf[i] !== '"') throw new SyntaxError(`expected an entity name at ${consumed + i}`)
                const nameStart = i // rewind on a short read — see topKey
                const keyEnd = valueEnd(buf, i)
                if (keyEnd === -1) break
                const name = JSON.parse(buf.slice(i, keyEnd))
                i = skipWs(keyEnd)
                if (i >= buf.length) { i = nameStart; break }
                if (buf[i] !== ":") throw new SyntaxError(`expected ':' after entity ${JSON.stringify(name)}`)
                entity = name
                i++
                state = "entityOpen"
                continue
            }

            if (state === "entityOpen") {
                if (buf[i] !== "[") throw new SyntaxError(`entity ${JSON.stringify(entity)} must hold an array of rows`)
                i++
                entityRows = 0
                events.push({ type: "entity", name: entity })
                state = "rows"
                continue
            }

            if (state === "rows") {
                if (buf[i] === ",") { i++; continue }
                if (buf[i] === "]") {
                    i++
                    events.push({ type: "entityEnd", name: entity, rows: entityRows })
                    entity = null
                    state = "dataKey"
                    continue
                }
                const end = valueEnd(buf, i)
                if (end === -1) break // this row is split across chunks
                events.push({ type: "row", entity, row: JSON.parse(buf.slice(i, end)) })
                entityRows++
                i = end
                continue
            }

            throw new SyntaxError(`unreachable scanner state ${state}`)
        }

        // Drop what has been consumed so the buffer stays the size of the
        // largest single value, not of the document.
        if (i > 0) {
            buf = buf.slice(i)
            consumed += i
        }
        return events
    }

    return {
        write(chunk) {
            if (finished) throw new Error("backup scanner: write after end()")
            buf += chunk
            return drain()
        },
        end() {
            const events = drain()
            finished = true
            if (state !== "done") {
                // A restore that applies the first half of a backup is worse
                // than one that fails, so this is loud.
                throw new SyntaxError(`backup ends mid-document (scanner stopped in state "${state}") — the file is truncated or not a backup`)
            }
            if (buf.trim().length) throw new SyntaxError("trailing content after the backup object")
            return events
        }
    }
}

export default { createBackupScanner, valueEnd }
