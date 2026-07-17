import shim from "./shim.js";

export default async function sha256(data, algorithm) {
  const text = typeof data === "string" ? data : await shim.stringify(data);
  const hash = await shim.subtle.digest(
    { name: algorithm || "SHA-256" },
    new shim.TextEncoder().encode(text),
  );
  return shim.Buffer.from(hash);
}
