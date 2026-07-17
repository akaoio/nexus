import secp256k1 from "./curves/secp256k1.js";
import p256 from "./curves/p256.js";

const MAP = { secp256k1, p256, secp256r1: p256 };

export default function crv(name) {
  return MAP[name] || MAP.secp256k1;
}
