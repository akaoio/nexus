// lib/builder/crypto.js — Build script for crypto.wasm
// Mirrors the pattern from lib/builder/pen.js.
//
// Compiles src/crypto.zig → src/crypto.wasm (and copies to root crypto.wasm).
// If Zig is not found, skips gracefully (the pre-built binary is used instead).

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = __dirnameOf(__filename);
const rootDir = nodePath.resolve(__dirname, "../..");
const src = nodePath.join(rootDir, "src/crypto.zig");
const out = nodePath.join(rootDir, "src/crypto.wasm");
const rootOut = nodePath.join(rootDir, "crypto.wasm");

const EXPORTS = [
  "alloc",
  "alloc_reset",
  "sha256",
  "keccak256",
  "ripemd160",
  "hmac_sha256",
  "b62_enc",
  "b62_dec",
  "b62_buf",
  "k1_mult_g",
  "k1_mult",
  "k1_add",
  "k1_det_k",
  "k1_hash_scalar",
  "p2_mult_g",
  "p2_mult",
  "p2_add",
  "p2_det_k",
  "p2_hash_scalar",
  "compact_point",
];

async function buildCrypto() {
  let zig = process.env.ZIG || "zig";

  const probe = spawnSync(zig, ["version"], { stdio: "pipe" });
  if (probe.error) {
    console.log(
      "zig not available, skipping crypto.wasm build (using pre-built binary)",
    );
    return;
  }

  const exportFlags = EXPORTS.map((name) => `--export=${name}`);

  const args = [
    "build-exe",
    src,
    "-target",
    "wasm32-freestanding",
    "-O",
    "ReleaseSmall",
    "-fno-entry",
    "-rdynamic",
    ...exportFlags,
    "-femit-bin=" + out,
  ];

  console.log("building crypto.wasm...");
  const result = spawnSync(zig, args, { stdio: "inherit", cwd: rootDir });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  fs.copyFileSync(out, rootOut);

  const size = fs.statSync(out).size;
  console.log(`crypto.wasm built: ${size} bytes`);
}

if (process.argv[1] && nodePath.resolve(process.argv[1]) === __filename) {
  buildCrypto().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

export default buildCrypto;
