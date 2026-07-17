import shim from "./shim.js";
import crv from "./curves.js";

async function sha1hash(bytes) {
  const crypto = shim.ossl || shim.subtle;
  return crypto.digest({ name: "SHA-1" }, new Uint8Array(bytes));
}

export default async function keyid(pub, curve) {
  const c = crv(curve || "secp256k1");
  let point;
  try {
    point = c.parsePub(pub);
  } catch (e) {
    // try p256 if secp256k1 fails
    point = crv("p256").parsePub(pub);
  }
  const xBytes = c.bigIntToBytes(point.x, 32);
  const yBytes = c.bigIntToBytes(point.y, 32);
  const pb = shim.Buffer.concat([
    shim.Buffer.from(xBytes),
    shim.Buffer.from(yBytes),
  ]);
  const id = shim.Buffer.concat([
    shim.Buffer.from([0x99, pb.length / 0x100, pb.length % 0x100]),
    pb,
  ]);
  const hash = shim.Buffer.from(await sha1hash(id), "binary");
  return hash.toString("hex", hash.length - 8);
}
