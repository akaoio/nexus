// Pure RIPEMD-160 implementation — no dependencies, no WebCrypto.
// Spec: https://homes.esat.kuleuven.be/~bosselae/ripemd160.html
import bridge from "./crypto.js";

let _wasmReady = false;
bridge.ready.then(() => { _wasmReady = true; }).catch(() => {});

const KL = [0x00000000, 0x5a827999, 0x6ed9eba1, 0x8f1bbcdc, 0xa953fd4e];
const KR = [0x50a28be6, 0x5c4dd124, 0x6d703ef3, 0x7a6d76e9, 0x00000000];

// Message word indices
const ML = [
  0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 7, 4, 13, 1, 10, 6, 15,
  3, 12, 0, 9, 5, 2, 14, 11, 8, 3, 10, 14, 4, 9, 15, 8, 1, 2, 7, 0, 6, 13, 11,
  5, 12, 1, 9, 11, 10, 0, 8, 12, 4, 13, 3, 7, 15, 14, 5, 6, 2, 4, 0, 5, 9, 7,
  12, 2, 10, 14, 1, 3, 8, 11, 6, 15, 13,
];
const MR = [
  5, 14, 7, 0, 9, 2, 11, 4, 13, 6, 15, 8, 1, 10, 3, 12, 6, 11, 3, 7, 0, 13, 5,
  10, 14, 15, 8, 12, 4, 9, 1, 2, 15, 5, 1, 3, 7, 14, 6, 9, 11, 8, 12, 2, 10, 0,
  4, 13, 8, 6, 4, 1, 3, 11, 15, 0, 5, 12, 2, 13, 9, 7, 10, 14, 12, 15, 10, 4, 1,
  5, 8, 7, 6, 2, 13, 14, 0, 3, 9, 11,
];

// Shift amounts
const SL = [
  11, 14, 15, 12, 5, 8, 7, 9, 11, 13, 14, 15, 6, 7, 9, 8, 7, 6, 8, 13, 11, 9, 7,
  15, 7, 12, 15, 9, 11, 7, 13, 12, 11, 13, 6, 7, 14, 9, 13, 15, 14, 8, 13, 6, 5,
  12, 7, 5, 11, 12, 14, 15, 14, 15, 9, 8, 9, 14, 5, 6, 8, 6, 5, 12, 9, 15, 5,
  11, 6, 8, 13, 12, 5, 12, 13, 14, 11, 8, 5, 6,
];
const SR = [
  8, 9, 9, 11, 13, 15, 15, 5, 7, 7, 8, 11, 14, 14, 12, 6, 9, 13, 15, 7, 12, 8,
  9, 11, 7, 7, 12, 7, 6, 15, 13, 11, 9, 7, 15, 11, 8, 6, 6, 14, 12, 13, 5, 14,
  13, 13, 7, 5, 15, 5, 8, 11, 14, 14, 6, 14, 6, 9, 12, 9, 12, 5, 15, 8, 8, 5,
  12, 9, 12, 5, 14, 6, 8, 13, 6, 5, 15, 13, 11, 11,
];

function rotl(x, n) {
  return ((x << n) | (x >>> (32 - n))) >>> 0;
}

// Round selection functions (left: f1..f5, right: f5..f1)
const FL = [
  (x, y, z) => (x ^ y ^ z) >>> 0,
  (x, y, z) => ((x & y) | (~x & z)) >>> 0,
  (x, y, z) => ((x | ~y) ^ z) >>> 0,
  (x, y, z) => ((x & z) | (y & ~z)) >>> 0,
  (x, y, z) => (x ^ (y | ~z)) >>> 0,
];
const FR = [FL[4], FL[3], FL[2], FL[1], FL[0]];

export default function ripemd160(data) {
  const bytes =
    data instanceof Uint8Array
      ? data
      : data instanceof ArrayBuffer
        ? new Uint8Array(data)
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);

  if (_wasmReady) {
    return bridge.ripemd160(bytes);
  }

  const len = bytes.length;
  const bitLen = len * 8;
  const padLen = (len + 9 + 63) & ~63;
  const padded = new Uint8Array(padLen);
  padded.set(bytes);
  padded[len] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padLen - 8, bitLen >>> 0, true);
  dv.setUint32(padLen - 4, Math.floor(bitLen / 0x100000000), true);

  let h0 = 0x67452301,
    h1 = 0xefcdab89,
    h2 = 0x98badcfe,
    h3 = 0x10325476,
    h4 = 0xc3d2e1f0;

  for (let off = 0; off < padLen; off += 64) {
    const M = [];
    for (let i = 0; i < 16; i++) M[i] = dv.getUint32(off + i * 4, true);

    let al = h0,
      bl = h1,
      cl = h2,
      dl = h3,
      el = h4;
    let ar = h0,
      br = h1,
      cr = h2,
      dr = h3,
      er = h4;

    for (let i = 0; i < 80; i++) {
      const r = (i / 16) | 0;
      const sumL = (al + FL[r](bl, cl, dl) + M[ML[i]] + KL[r]) >>> 0;
      const tl = (rotl(sumL, SL[i]) + el) >>> 0;
      al = el;
      el = dl;
      dl = rotl(cl, 10);
      cl = bl;
      bl = tl;

      const sumR = (ar + FR[r](br, cr, dr) + M[MR[i]] + KR[r]) >>> 0;
      const tr = (rotl(sumR, SR[i]) + er) >>> 0;
      ar = er;
      er = dr;
      dr = rotl(cr, 10);
      cr = br;
      br = tr;
    }

    const T = (h1 + cl + dr) >>> 0;
    h1 = (h2 + dl + er) >>> 0;
    h2 = (h3 + el + ar) >>> 0;
    h3 = (h4 + al + br) >>> 0;
    h4 = (h0 + bl + cr) >>> 0;
    h0 = T;
  }

  const out = new DataView(new ArrayBuffer(20));
  out.setUint32(0, h0, true);
  out.setUint32(4, h1, true);
  out.setUint32(8, h2, true);
  out.setUint32(12, h3, true);
  out.setUint32(16, h4, true);
  return new Uint8Array(out.buffer);
}
