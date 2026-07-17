import __path from "path";
import Zen from "../zen.js";
import fs from "fs";
import tpath from "./tpath.js";

Zen.on("create", function (root) {
  this.to.next(root);
  var opt = root.opt;
  if (true !== opt.localStorage) {
    return;
  }
  if (false === opt.localStorage) {
    return;
  }
  //if(process.env.RAD_ENV){ return }
  //if(process.env.AWS_S3_BUCKET){ return }
  opt.file = tpath(opt.file, "data.json", Zen && Zen.TESTING);
  var graph = root.graph,
    acks = {},
    count = 0,
    to;
  var disk =
    Zen.obj.ify(
      (fs.existsSync || __path.existsSync)(opt.file)
        ? fs.readFileSync(opt.file).toString()
        : null,
    ) || {};

  Zen.log.once(
    "file-warning",
    "WARNING! This `file.js` module for zen is " +
      "intended for local development testing only!",
  );

  root.on("put", function (at) {
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

  root.on("get", function (at) {
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
    if (Zen.obj.is(soul)) {
      return match(at);
    }
    var field = lex["."];
    data = disk[soul] || u;
    if (data && field) {
      data = Zen.state.to(data, field);
    }
    root.on("in", { "@": at["#"], put: Zen.graph.node(data) });
    //},11);
  });

  var map = function (val, key, node, soul) {
    disk[soul] = Zen.state.to(node, key, disk[soul]);
  };

  var wait, u;
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
    clearTimeout(to);
    to = false;
    var ack = acks;
    acks = {};
    ensureDir();
    fs.writeFile(opt.file, JSON.stringify(disk), function (err, ok) {
      wait = false;
      var tmp = count;
      count = 0;
      Zen.obj.map(ack, function (yes, id) {
        root.on("in", {
          "@": id,
          err: err,
          ok: err ? u : 1,
        });
      });
      if (1 < tmp) {
        flush();
      }
    });
  };

  function match(at) {
    var rgx = at.get["#"],
      has = at.get["."];
    Zen.obj.map(disk, function (node, soul, put) {
      if (!Zen.text.match(soul, rgx)) {
        return;
      }
      if (has) {
        node = Zen.state.to(node, has);
      }
      (put = {})[soul] = node;
      root.on("in", { put: put, "@": at["#"] });
    });
  }
});
