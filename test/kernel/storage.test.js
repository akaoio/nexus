/**
 * Kernel conformance — BROWSER STORAGE (KRN-OP, KRN-ID).
 * OPFS and IndexedDB need a real browser; these clauses are browser-marked
 * and run under the browser runner (akao's /test route pattern).
 */

import Test, { assert } from "../../src/kernel/Test.js"
import OPFS from "../../src/kernel/OPFS.js"
import IDB from "../../src/kernel/IDB.js"

Test.describe("Kernel — OPFS (KRN-OP, browser)", () => {
    Test.it("KRN-OP01 write/load round-trips bytes under an instance root", async () => {
        const opfs = new OPFS({ root: "krn-op-test" })
        const bytes = new TextEncoder().encode("hello opfs")
        await opfs.write(["dir", "file.txt"], bytes)
        const loaded = new Uint8Array(await opfs.load(["dir", "file.txt"]))
        assert.equal(new TextDecoder().decode(loaded), "hello opfs")
    })

    Test.it("KRN-OP02 exist/dir/move/remove manage the tree", async () => {
        const opfs = new OPFS({ root: "krn-op-test" })
        assert.equal(await opfs.exist(["dir", "file.txt"]), true)
        assert.truthy((await opfs.dir(["dir"])).includes("file.txt"))
        await opfs.move(["dir", "file.txt"], ["dir", "moved.txt"])
        assert.equal(await opfs.exist(["dir", "file.txt"]), false)
        await opfs.remove(["dir"])
        assert.equal(await opfs.exist(["dir"]), false)
    })
}, { browser: true })

Test.describe("Kernel — IDB (KRN-ID, browser)", () => {
    Test.it("KRN-ID01 put/get/del/keys round-trip through IndexedDB", async () => {
        const idb = new IDB({ name: "krn-id-test" })
        await idb.ready
        await idb.put("user:1", { name: "alice" })
        assert.deepEqual(await idb.get("user:1"), { name: "alice" })
        assert.truthy((await idb.keys()).includes("user:1"))
        await idb.del("user:1")
        assert.equal(await idb.get("user:1"), undefined)
    })
}, { browser: true })
