/**
 * Kernel conformance — FILE SYSTEM (KRN-FS).
 *
 * Runs against the REAL Node driver in a temp directory (globalThis._root
 * steers FS.root). Pins the isomorphic path contract, the JSON round-trip,
 * the decoupled format registry, and directory hashing. The browser side
 * (HTTP-first + OPFS cache + miss fallbacks) is pinned by KRN-OP clauses.
 */

import { mkdtempSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join as joinPath } from "path"
import Test, { assert } from "../../src/core/Test.js"
import FS, { registerFormat } from "../../src/core/FS.js"
import { sha256, WIN } from "../../src/core/Utils.js"

const TMP = mkdtempSync(joinPath(tmpdir(), "nexus-fs-"))
globalThis._root = TMP
const SEP = WIN ? "\\" : "/"

Test.describe("Kernel — file system (KRN-FS)", () => {
    Test.it("KRN-FS01 root() honors globalThis._root; join() uses the platform separator", () => {
        assert.equal(FS.root(), TMP)
        assert.equal(FS.join(["a", "b", "c.json"]), TMP + SEP + ["a", "b", "c.json"].join(SEP))
    })

    Test.it("KRN-FS02 JSON round-trips through write/load as parsed data", async () => {
        const data = { name: "nexus", nested: { list: [1, 2, 3] } }
        const result = await FS.write(["data", "config.json"], data)
        assert.equal(result.success, true)
        assert.deepEqual(await FS.load(["data", "config.json"]), data)
    })

    Test.it("KRN-FS03 writing an object to a path without extension is refused", async () => {
        assert.equal(await FS.write(["data", "noext"], { a: 1 }), undefined)
        assert.equal(await FS.exist(["data", "noext"]), false)
    })

    Test.it("KRN-FS04 binary content round-trips as Uint8Array", async () => {
        const bytes = new Uint8Array([0, 255, 128, 7])
        await FS.write(["blobs", "raw.bin"], bytes)
        const loaded = await FS.load(["blobs", "raw.bin"])
        assert.truthy(loaded instanceof Uint8Array)
        assert.deepEqual([...loaded], [0, 255, 128, 7])
    })

    Test.it("KRN-FS05 unregistered text extensions round-trip as raw strings", async () => {
        await FS.write(["docs", "note.md"], "# hello\n\nworld")
        assert.equal(await FS.load(["docs", "note.md"]), "# hello\n\nworld")
    })

    Test.it("KRN-FS06 the format registry drives write/load for registered extensions", async () => {
        registerFormat("kv", {
            parse: (text) => Object.fromEntries(text.split("\n").map((l) => l.split("="))),
            stringify: (value) => Object.entries(value).map(([k, v]) => `${k}=${v}`).join("\n")
        })
        await FS.write(["data", "settings.kv"], { theme: "dark", lang: "vi" })
        assert.deepEqual(await FS.load(["data", "settings.kv"]), { theme: "dark", lang: "vi" })
    })

    Test.it("KRN-FS07 ensure creates directories; exist/isDirectory report correctly", async () => {
        assert.equal(await FS.ensure(["deep", "nested", "dir"]), true)
        assert.equal(await FS.exist(["deep", "nested", "dir"]), true)
        assert.equal(await FS.isDirectory(["deep", "nested", "dir"]), true)
        assert.equal(await FS.isDirectory(["data", "config.json"]), false)
        assert.equal(await FS.exist(["ghost"]), false)
    })

    Test.it("KRN-FS08 dir() lists entries; dir(pattern) walks recursively", async () => {
        await FS.write(["tree", "a.json"], { a: 1 })
        await FS.write(["tree", "sub", "b.json"], { b: 2 })
        await FS.write(["tree", "sub", "c.md"], "c")
        const names = await FS.dir(["tree"])
        assert.truthy(names.includes("a.json") && names.includes("sub"))
        const jsons = await FS.dir(["tree"], /\.json$/)
        assert.deepEqual(jsons.sort(), ["a.json", "sub/b.json"])
    })

    Test.it("KRN-FS09 copy recurses directories; move relocates; remove deletes", async () => {
        await FS.copy(["tree"], ["tree2"])
        assert.deepEqual(await FS.load(["tree2", "sub", "b.json"]), { b: 2 })
        await FS.move(["tree2", "a.json"], ["tree2", "renamed.json"])
        assert.equal(await FS.exist(["tree2", "a.json"]), false)
        assert.deepEqual(await FS.load(["tree2", "renamed.json"]), { a: 1 })
        await FS.remove(["tree2"])
        assert.equal(await FS.exist(["tree2"]), false)
    })

    Test.it("KRN-FS10 find returns the first existing path and throws when none exist", async () => {
        const found = await FS.find([["ghost.json"], ["data", "config.json"]])
        assert.deepEqual(found, ["data", "config.json"])
        await Test.assert.rejects(FS.find([["ghost1"], ["ghost2"]]), "Could not find path")
    })

    Test.it("KRN-FS11 isBinary classifies by extension (text list is the contract)", () => {
        assert.equal(FS.isBinary("statics/logo.png"), true)
        assert.equal(FS.isBinary(["fonts", "x.woff2"]), true)
        for (const text of ["a.json", "b.yaml", "c.md", "d.js", "e.hash"]) assert.equal(FS.isBinary(text), false)
        assert.equal(FS.isBinary("noext"), false)
    })

    Test.it("KRN-FS12 hash: file hash is the sha256 of its content; dir hash honors exclude", async () => {
        await FS.write(["hashme", "v.txt"], "abc")
        assert.equal(await FS.hash(["hashme", "v.txt"]), sha256("abc"))
        assert.equal(sha256("abc"), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        const full = await FS.hash(["hashme"])
        await FS.write(["hashme", "extra.txt"], "x")
        const changed = await FS.hash(["hashme"])
        assert.notEqual(full, changed)
        assert.equal(await FS.hash(["hashme"], ["extra.txt"]), full)
    })

    Test.it("KRN-FS99 cleanup temp root", () => {
        delete globalThis._root
        rmSync(TMP, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 })
        assert.equal(globalThis._root, undefined)
    })
})
