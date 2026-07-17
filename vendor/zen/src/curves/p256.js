// P-256 / secp256r1 curve — same Weierstrass math as secp256k1, different constants.
// A = P - 3 (i.e. -3 mod P), so the doubling formula includes the A term.
import shim from "../shim.js";
import base62 from "../base62.js";
import sha256 from "../sha256.js";
import settings from "../settings.js";
import aeskey from "../aeskey.js";
import hash from "../hash.js";
import createCurveCore from "./utils.js";
import bridge from "../crypto.js";

const P = BigInt(
  "0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF",
);
const N = BigInt(
  "0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551",
);
const A = P - 3n; // -3 mod P
const B = BigInt(
  "0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B",
);
const G = {
  x: BigInt(
    "0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296",
  ),
  y: BigInt(
    "0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5",
  ),
};
const core = createCurveCore({
  curve: "p256",
  P,
  N,
  A,
  B,
  G,
  shim,
  base62,
  settings,
  sha256,
  extras: { aeskey, hash },
});

// Wire WASM fast-path once the bridge is ready.
bridge.ready.then(function () {
  function toB(bi) { return core.bigIntToBytes(bi, 32); }
  function fromB(u8) { return core.bytesToBigInt(u8); }

  core.deterministicK = function (priv, hashBytes, attempt) {
    return Promise.resolve(fromB(bridge.p2DetK(toB(priv), hashBytes, attempt || 0)));
  };
}).catch(function () { /* WASM unavailable — BigInt fallback remains active */ });

export default core;
