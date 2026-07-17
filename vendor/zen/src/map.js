import __root from "./root.js";

var Zen = __root,
  next = Zen.chain.get.next;
Zen.chain.get.next = function (zen, lex) {
  var tmp;
  if (!Object.plain(lex)) {
    return (next || noop)(zen, lex);
  }
  if ((tmp = ((tmp = lex["#"]) || "")["="] || tmp)) {
    return zen.get(tmp);
  }
  (tmp = zen.chain()._).lex = lex; // LEX!
  zen.on("in", function (eve) {
    if (
      String.match(eve.get || (eve.put || "")["."], lex["."] || lex["#"] || lex)
    ) {
      tmp.on("in", eve);
    }
    this.to.next(eve);
  });
  return tmp.$;
};
Zen.chain.map = function (cb, opt, t) {
  var zen = this,
    cat = zen._,
    lex,
    chain;
  if (Object.plain(cb)) {
    lex = cb["."] ? cb : { ".": cb };
    cb = u;
  }
  if (!cb) {
    if ((chain = cat.each)) {
      return chain;
    }
    (cat.each = chain = zen.chain())._.lex = lex || chain._.lex || cat.lex;
    chain._.nix = zen.back("nix");
    zen.on("in", map, chain._);
    return chain;
  }
  Zen.log.once(
    "mapfn",
    "Map functions are experimental, their behavior and API may change moving forward. Please play with it and report bugs and ideas on how to improve it.",
  );
  chain = zen.chain();
  zen.map().on(function (data, key, msg, eve) {
    var next = (cb || noop).call(this, data, key, msg, eve);
    if (u === next) {
      return;
    }
    if (data === next) {
      return chain._.on("in", msg);
    }
    if (Zen.is(next)) {
      return chain._.on("in", next._);
    }
    var tmp = {};
    Object.keys(msg.put).forEach(function (k) {
      tmp[k] = msg.put[k];
    }, tmp);
    tmp["="] = next;
    chain._.on("in", { get: key, put: tmp });
  });
  return chain;
};
function map(msg) {
  this.to.next(msg);
  var cat = this.as,
    zen = msg.$,
    at = zen._,
    put = msg.put,
    tmp;
  if (!at.soul && !msg.$$) {
    return;
  } // this line took hundreds of tries to figure out. It only works if core checks to filter out above chains during link tho. This says "only bother to map on a node" for this layer of the chain. If something is not a node, map should not work.
  if (
    (tmp = cat.lex) &&
    !String.match(msg.get || (put || "")["."], tmp["."] || tmp["#"] || tmp)
  ) {
    return;
  }
  Zen.on.link(msg, cat);
}
var noop = function () {},
  event = { stun: noop, off: noop },
  u;
