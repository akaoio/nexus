import shim from "./shim.js";
import bridge from "./crypto.js";

export default async function keccak256(data) {
  await bridge.ready;
  const bytes = shim.toBytes(data);
  return shim.Buffer.from(bridge.keccak256(bytes));
}
