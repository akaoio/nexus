import shim from "./shim.js";
import settings from "./settings.js";
import sha256 from "./sha256.js";

export default async function aeskey(key, salt, opt) {
  opt = opt || {};
  const combo = key + (salt || shim.random(8)).toString("utf8");
  const hash = shim.Buffer.from(await sha256(combo), "binary");
  const jwkKey = settings.keyToJwk(hash);
  return await shim.subtle.importKey(
    "jwk",
    jwkKey,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
