import ZEN from "../zen.js";
import __events from "events";

let __defaultExport;
var Zen = ZEN;
var debug = false;

Zen.on("opt", function (ctx) {
  var opt = ctx.opt;
  var ev = this.to;

  if (debug) debug.emit("create");
  if (ctx.once) return ev.next(ctx);

  // Check if the given 'level' argument implements all the components we need
  // Intentionally doesn't check for levelup explicitly, to allow different handlers implementing the same api
  if (
    !opt.level ||
    "object" !== typeof opt.level ||
    "function" !== typeof opt.level.get ||
    "function" !== typeof opt.level.put
  ) {
    return;
  }

  ctx.on("put", function (msg) {
    this.to.next(msg);

    // Extract data from message
    var put = msg.put;
    var soul = put["#"];
    var key = put["."];
    var val = put[":"];
    var state = put[">"];

    if (debug) debug.emit("put", soul, val);

    // Fetch previous version
    opt.level.get(soul, function (err, data) {
      if (err && err.name === "NotFoundError") err = undefined;
      if (debug && err) debug.emit("error", err);
      if (err) return;

      // Unclear required transformation
      data = Zen.state.ify(data, key, state, val, soul);

      // Write into storage
      opt.level.put(soul, data, function (err) {
        if (err) return;
        if (debug) debug.emit("put", soul, val);

        // Bail if message was an ack
        if (msg["@"]) return;

        // Send ack back
        ctx.on("in", {
          "@": msg["@"],
          ok: 0,
        });
      });
    });
  });

  ctx.on("get", function (msg) {
    this.to.next(msg);

    // Extract soul from message
    var lex = msg.get;
    if (!lex || !(soul = lex["#"])) return;
    var has = lex["."];

    if (debug) debug.emit("get", soul);

    // Fetch data from storage
    opt.level.get(soul, function (err, data) {
      if (err) return;

      // Another unclear transformation
      if (data && has) {
        data = Zen.state.to(data, has);
      }

      // Emulate incoming ack
      ctx.on("in", {
        "@": msg["#"],
        put: Zen.graph.node(data),
      });
    });
  });
});

// Export debug interface
if ("undefined" === typeof globalThis) {
  var EventEmitter = __events.EventEmitter;
  __defaultExport = debug = new EventEmitter();
}
export default __defaultExport;
