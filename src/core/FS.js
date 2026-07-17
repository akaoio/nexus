/**
 * File system abstraction — isomorphic: Node fs on the server, OPFS in the
 * browser (with HTTP-first loading). Extracted from akao src/core/FS.js with
 * two decouplings: formats are a registry (kernel ships JSON only — YAML/CSV
 * register app-side) and browser miss-fallbacks are hooks (akao's torrent
 * leech registers app-side). All paths are arrays of segments.
 */

import { root } from "./FS/root.js"
import { join } from "./FS/join.js"
import { ensure } from "./FS/ensure.js"
import { remove } from "./FS/remove.js"
import { write } from "./FS/write.js"
import { load } from "./FS/load.js"
import { download } from "./FS/download.js"
import { find } from "./FS/find.js"
import { copy } from "./FS/copy.js"
import { dir } from "./FS/dir.js"
import { exist } from "./FS/exist.js"
import { isDirectory } from "./FS/isDirectory.js"
import { hash } from "./FS/hash.js"
import { move } from "./FS/move.js"
import { registerFormat, registerFallback } from "./FS/formats.js"
import { isBinary, TEXT_EXTS } from "./FS/shared.js"

export class FS {
    static root = root
    static join = join
    static ensure = ensure
    static remove = remove
    static write = write
    static load = load
    static download = download
    static find = find
    static copy = copy
    static dir = dir
    static exist = exist
    static isDirectory = isDirectory
    static hash = hash
    static move = move
    static registerFormat = registerFormat
    static registerFallback = registerFallback
    static isBinary = isBinary
}

export default FS

// Re-export all functions as named exports for convenience
export { root, join, ensure, remove, write, load, download, find, copy, dir, exist, isDirectory, hash, move, registerFormat, registerFallback, isBinary, TEXT_EXTS }
