import fs from "node:fs";
import { spawnSync } from "node:child_process";
import nodePath from "node:path";
import { fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = __dirnameOf(__filename);
const rootDir = nodePath.resolve(__dirname, "../..");
const src = nodePath.join(rootDir, "src/wasm.zig");
const out = nodePath.join(rootDir, "src/pen.wasm");
const rootOut = nodePath.join(rootDir, "pen.wasm");

async function buildPEN() {
  let zig = process.env.ZIG || "zig";

  const probe = spawnSync(zig, ["version"], { stdio: "pipe" });
  if (probe.error) {
    console.log(
      "zig not available, skipping pen.wasm build (using pre-built binary)",
    );
    return;
  }

  const args = [
    "build-exe",
    src,
    "-target",
    "wasm32-freestanding",
    "-O",
    "ReleaseSmall",
    "-fno-entry",
    "-rdynamic",
    "--export=run",
    "--export=alloc",
    "--export=free",
    "--export=mem",
    "-femit-bin=" + out,
  ];

  console.log("building pen.wasm...");
  const result = spawnSync(zig, args, { stdio: "inherit", cwd: rootDir });
  if (result.status !== 0) {
    process.exit(result.status || 1);
  }

  fs.copyFileSync(out, rootOut);

  const size = fs.statSync(out).size;
  console.log(`pen.wasm built locally: ${size} bytes`);
}

if (process.argv[1] && nodePath.resolve(process.argv[1]) === __filename) {
  buildPEN().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}

export default buildPEN;
