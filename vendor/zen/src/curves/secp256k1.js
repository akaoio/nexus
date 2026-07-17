import shim from "../shim.js";
import base62 from "../base62.js";
import settings from "../settings.js";
import aeskey from "../aeskey.js";
import sha256 from "../sha256.js";
import hash from "../hash.js";
import createCurveCore from "./utils.js";
import bridge from "../crypto.js";

const P = BigInt(
  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2F",
);
const N = BigInt(
  "0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141",
);
const A = 0n;
const B = 7n;
const G = {
  x: BigInt(
    "0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798",
  ),
  y: BigInt(
    "0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8",
  ),
};
const core = createCurveCore({
  curve: "secp256k1",
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
// Falls back to BigInt automatically if WASM is unavailable.
bridge.ready.then(function () {
  function toB(bi) { return core.bigIntToBytes(bi, 32); }
  function fromB(u8) { return core.bytesToBigInt(u8); }

  // WASM deterministicK is synchronous and ~40× faster than the HMAC-SHA256 JS path.
  core.deterministicK = function (priv, hashBytes, attempt) {
    return Promise.resolve(fromB(bridge.k1DetK(toB(priv), hashBytes, attempt || 0)));
  };
}).catch(function () { /* WASM unavailable — BigInt fallback remains active */ });

export default core;
