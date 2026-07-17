import __path from "path";
import Zen from "../zen.js";
import fs from "fs";
import tpath from "./tpath.js";

Zen.on("opt", function (ctx) {
  this.to.next(ctx);
  var opt = ctx.opt;
  if (ctx.once) {
    return;
  }
  opt.file = tpath(opt.file, "data.json", Zen && Zen.TESTING);
  var graph = ctx.graph,
    acks = {},
    count = 0,
    to;
  var disk =
    Zen.obj.ify(
      (fs.existsSync || __path.existsSync)(opt.file)
        ? fs.readFileSync(opt.file).toString()
        : null,
    ) || {};

  ctx.on("put", function (at) {
    this.to.next(at);
    Zen.graph.is(at.put, null, map);
    if (!at["@"]) {
      acks[at["#"]] = true;
    } // only ack non-acks.
    count += 1;
    if (count >= (opt.batch || 10000)) {
      return flush();
    }
    if (to) {
      return;
    }
    to = setTimeout(flush, opt.wait || 1);
  });

  ctx.on("get", function (at) {
    this.to.next(at);
    var lex = at.get,
      soul,
      data,
      opt,
      u;
    //setTimeout(function(){
    if (!lex || !(soul = lex["#"])) {
      return;
    }
    //if(0 >= at.cap){ return }
    var field = lex["."];
    data = disk[soul] || u;
    if (data && field) {
      data = Zen.state.to(data, field);
    }
    ctx.on("in", { "@": at["#"], put: Zen.graph.node(data) });
    //},11);
  });

  var map = function (val, key, node, soul) {
    disk[soul] = Zen.state.to(node, key, disk[soul]);
  };

  var wait;
  function ensureDir() {
    var dir = __path.dirname(opt.file);
    if ("." !== dir && !fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
  var flush = function () {
    if (wait) {
      return;
    }
    wait = true;
    clearTimeout(to);
    to = false;
    var ack = acks;
    acks = {};
    ensureDir();
    fs.writeFile(opt.file, JSON.stringify(disk, null, 2), function (err, ok) {
      wait = false;
      var tmp = count;
      count = 0;
      Zen.obj.map(ack, function (yes, id) {
        ctx.on("in", {
          "@": id,
          err: err,
          ok: 0, // memdisk should not be relied upon as permanent storage.
        });
      });
      if (1 < tmp) {
        flush();
      }
    });
  };
});
