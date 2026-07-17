import __fs from "fs";
import { fileURLToPath } from "node:url";
import { dirname as __dirnameOf } from "node:path";
const __filename = fileURLToPath(import.meta.url);
const __dirname = __dirnameOf(__filename);
try {
  var fs = __fs,
    logs = [],
    up = __dirname + "/../";
  fs.readdir(up, function (err, list) {
    try {
      var i = 0,
        f;
      while ((f = list[i++])) {
        if (0 === f.indexOf("isolate-") && ".log" === f.slice(-4)) {
          logs.push(f);
        }
      }
      logs = logs.sort();
      var i = 0,
        f,
        lf;
      while ((f = list[i++])) {
        if (0 <= f.indexOf("-v8-") && ".log" === f.slice(-4)) {
          lf = f;
        }
      }
      f = lf;
      if (!f) {
        return;
      }
      fs.rename(up + f, up + "v8.log", function (err, ok) {
        var i = 0,
          f;
        while ((f = logs[i++])) {
          fs.unlink(up + f, noop);
        }
      });
    } catch (e) {}
  });
  function noop() {}
} catch (e) {}
