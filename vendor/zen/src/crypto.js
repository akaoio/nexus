// src/crypto.js — Lazy loader and JS bridge for crypto.wasm.
//
// Usage:
//   import bridge from "./crypto.js";
//   await bridge.ready;
//   const hash = bridge.keccak256(bytes);  // synchronous once ready
//
// All primitive calls are synchronous after the initial WASM load.
// The module exposes typed wrappers that handle WASM memory management.

const __cryptoWasmURL = new URL("./crypto.wasm", import.meta.url);

let _wasm = null;

function _load() {
  if (
    typeof process !== "undefined" &&
    process.versions &&
    process.versions.node
  ) {
    return import("node:fs/promises")
      .then((mod) => (mod.readFile || (mod.default || {}).readFile)(__cryptoWasmURL))
      .then((bytes) => WebAssembly.instantiate(bytes, {}))
      .then((r) => {
        _wasm = r;
      });
  }
  if (typeof fetch !== "undefined") {
    return fetch(__cryptoWasmURL)
      .then((r) => {
        if (!r.ok)
          throw new Error("crypto.wasm fetch failed: " + r.status + " " + r.url);
        return r.arrayBuffer();
      })
      .then((buf) => WebAssembly.instantiate(buf, {}))
      .then((r) => {
        _wasm = r;
      });
  }
  return Promise.reject(new Error("crypto_wasm_bridge: cannot load crypto.wasm"));
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function _exports() {
  return _wasm.instance.exports;
}

function _view() {
  return new Uint8Array(_wasm.instance.exports.memory.buffer);
}

function _write(bytes) {
  const ex = _exports();
  ex.alloc_reset();
  const ptr = ex.alloc(bytes.length);
  _view().set(bytes, ptr);
  return ptr;
}

function _alloc(size) {
  return _exports().alloc(size);
}

function _read(ptr, len) {
  return _view().slice(ptr, ptr + len);
}

// ── Public typed wrappers ────────────────────────────────────────────────────

const bridge = {
  ready: _load(),

  /** SHA-256: Uint8Array → Uint8Array (32 bytes) */
  sha256(data) {
    const ex = _exports();
    ex.alloc_reset();
    const inPtr = ex.alloc(data.length);
    _view().set(data, inPtr);
    const outPtr = ex.alloc(32);
    ex.sha256(inPtr, data.length, outPtr);
    return _view().slice(outPtr, outPtr + 32);
  },

  /** Keccak-256: Uint8Array → Uint8Array (32 bytes) */
  keccak256(data) {
    const ex = _exports();
    ex.alloc_reset();
    const inPtr = ex.alloc(data.length);
    _view().set(data, inPtr);
    const outPtr = ex.alloc(32);
    ex.keccak256(inPtr, data.length, outPtr);
    return _view().slice(outPtr, outPtr + 32);
  },

  /** RIPEMD-160: Uint8Array → Uint8Array (20 bytes) */
  ripemd160(data) {
    const ex = _exports();
    ex.alloc_reset();
    const inPtr = ex.alloc(data.length);
    _view().set(data, inPtr);
    const outPtr = ex.alloc(20);
    ex.ripemd160(inPtr, data.length, outPtr);
    return _view().slice(outPtr, outPtr + 20);
  },

  /** HMAC-SHA-256: (key: Uint8Array, data: Uint8Array) → Uint8Array (32 bytes) */
  hmacSha256(key, data) {
    const ex = _exports();
    ex.alloc_reset();
    const kPtr = ex.alloc(key.length);
    _view().set(key, kPtr);
    const dPtr = ex.alloc(data.length);
    _view().set(data, dPtr);
    const outPtr = ex.alloc(32);
    ex.hmac_sha256(kPtr, key.length, dPtr, data.length, outPtr);
    return _view().slice(outPtr, outPtr + 32);
  },

  /** Base62 encode: 32-byte Uint8Array → 44-char Uint8Array (ASCII) */
  b62Encode(bytes32) {
    const ex = _exports();
    ex.alloc_reset();
    const inPtr = ex.alloc(32);
    _view().set(bytes32, inPtr);
    const outPtr = ex.alloc(44);
    ex.b62_enc(inPtr, outPtr);
    return _view().slice(outPtr, outPtr + 44);
  },

  /** Base62 decode: 44-char string/Uint8Array → 32-byte Uint8Array or null */
  b62Decode(input44) {
    const ex = _exports();
    const bytes =
      typeof input44 === "string"
        ? new TextEncoder().encode(input44)
        : input44;
    ex.alloc_reset();
    const inPtr = ex.alloc(44);
    _view().set(bytes.subarray(0, 44), inPtr);
    const outPtr = ex.alloc(32);
    const ok = ex.b62_dec(inPtr, outPtr);
    return ok === 0 ? _view().slice(outPtr, outPtr + 32) : null;
  },

  // ── secp256k1 ──────────────────────────────────────────────────────────────

  /** scalar × G → {x: Uint8Array(32), y: Uint8Array(32)} or null */
  k1MultG(scalar32) {
    const ex = _exports();
    ex.alloc_reset();
    const sPtr = ex.alloc(32);
    _view().set(scalar32, sPtr);
    const outPtr = ex.alloc(64);
    if (!ex.k1_mult_g(sPtr, outPtr)) return null;
    const v = _view();
    return { x: v.slice(outPtr, outPtr + 32), y: v.slice(outPtr + 32, outPtr + 64) };
  },

  /** scalar × point → {x, y} or null */
  k1Mult(scalar32, px32, py32) {
    const ex = _exports();
    ex.alloc_reset();
    const sPtr = ex.alloc(32);
    _view().set(scalar32, sPtr);
    const pxPtr = ex.alloc(32);
    _view().set(px32, pxPtr);
    const pyPtr = ex.alloc(32);
    _view().set(py32, pyPtr);
    const outPtr = ex.alloc(64);
    if (!ex.k1_mult(sPtr, pxPtr, pyPtr, outPtr)) return null;
    const v = _view();
    return { x: v.slice(outPtr, outPtr + 32), y: v.slice(outPtr + 32, outPtr + 64) };
  },

  /** point + point → {x, y} or null */
  k1Add(ax32, ay32, bx32, by32) {
    const ex = _exports();
    ex.alloc_reset();
    const axPtr = ex.alloc(32); _view().set(ax32, axPtr);
    const ayPtr = ex.alloc(32); _view().set(ay32, ayPtr);
    const bxPtr = ex.alloc(32); _view().set(bx32, bxPtr);
    const byPtr = ex.alloc(32); _view().set(by32, byPtr);
    const outPtr = ex.alloc(64);
    if (!ex.k1_add(axPtr, ayPtr, bxPtr, byPtr, outPtr)) return null;
    const v = _view();
    return { x: v.slice(outPtr, outPtr + 32), y: v.slice(outPtr + 32, outPtr + 64) };
  },

  /** RFC 6979 deterministic k for secp256k1 → Uint8Array(32) */
  k1DetK(priv32, hash32, attempt) {
    const ex = _exports();
    ex.alloc_reset();
    const privPtr = ex.alloc(32); _view().set(priv32, privPtr);
    const hashPtr = ex.alloc(32); _view().set(hash32, hashPtr);
    const outPtr = ex.alloc(32);
    ex.k1_det_k(privPtr, hashPtr, attempt || 0, outPtr);
    return _view().slice(outPtr, outPtr + 32);
  },

  // ── P-256 ──────────────────────────────────────────────────────────────────

  p2MultG(scalar32) {
    const ex = _exports();
    ex.alloc_reset();
    const sPtr = ex.alloc(32); _view().set(scalar32, sPtr);
    const outPtr = ex.alloc(64);
    if (!ex.p2_mult_g(sPtr, outPtr)) return null;
    const v = _view();
    return { x: v.slice(outPtr, outPtr + 32), y: v.slice(outPtr + 32, outPtr + 64) };
  },

  p2Mult(scalar32, px32, py32) {
    const ex = _exports();
    ex.alloc_reset();
    const sPtr = ex.alloc(32); _view().set(scalar32, sPtr);
    const pxPtr = ex.alloc(32); _view().set(px32, pxPtr);
    const pyPtr = ex.alloc(32); _view().set(py32, pyPtr);
    const outPtr = ex.alloc(64);
    if (!ex.p2_mult(sPtr, pxPtr, pyPtr, outPtr)) return null;
    const v = _view();
    return { x: v.slice(outPtr, outPtr + 32), y: v.slice(outPtr + 32, outPtr + 64) };
  },

  p2Add(ax32, ay32, bx32, by32) {
    const ex = _exports();
    ex.alloc_reset();
    const axPtr = ex.alloc(32); _view().set(ax32, axPtr);
    const ayPtr = ex.alloc(32); _view().set(ay32, ayPtr);
    const bxPtr = ex.alloc(32); _view().set(bx32, bxPtr);
    const byPtr = ex.alloc(32); _view().set(by32, byPtr);
    const outPtr = ex.alloc(64);
    if (!ex.p2_add(axPtr, ayPtr, bxPtr, byPtr, outPtr)) return null;
    const v = _view();
    return { x: v.slice(outPtr, outPtr + 32), y: v.slice(outPtr + 32, outPtr + 64) };
  },

  p2DetK(priv32, hash32, attempt) {
    const ex = _exports();
    ex.alloc_reset();
    const privPtr = ex.alloc(32); _view().set(priv32, privPtr);
    const hashPtr = ex.alloc(32); _view().set(hash32, hashPtr);
    const outPtr = ex.alloc(32);
    ex.p2_det_k(privPtr, hashPtr, attempt || 0, outPtr);
    return _view().slice(outPtr, outPtr + 32);
  },

  // ── Shared ──────────────────────────────────────────────────────────────────

  /** Compressed point encoding: (x32, y32) → Uint8Array(33) */
  compactPoint(x32, y32) {
    const ex = _exports();
    ex.alloc_reset();
    const xPtr = ex.alloc(32); _view().set(x32, xPtr);
    const yPtr = ex.alloc(32); _view().set(y32, yPtr);
    const outPtr = ex.alloc(33);
    ex.compact_point(xPtr, yPtr, outPtr);
    return _view().slice(outPtr, outPtr + 33);
  },
};

export default bridge;
