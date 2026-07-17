import fs from "fs";
import nodePath from "path";
import { fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = __dirnameOf(__filename);
var dir = __dirname + "/../";

export default function rm(path, full) {
  path = full || nodePath.join(dir, path);
  if (!fs.existsSync(path)) {
    return;
  }
  fs.readdirSync(path).forEach(function (file, index) {
    var curPath = path + "/" + file;
    if (fs.lstatSync(curPath).isDirectory()) {
      // recurse
      rm(null, curPath);
    } else {
      // delete file
      fs.unlinkSync(curPath);
    }
  });
  fs.rmdirSync(path);
}
