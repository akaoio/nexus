import __root from "./root.js";

var Zen = __root;
Zen.chain.set = function (item, cb, opt) {
  var zen = this,
    root = zen.back(-1),
    soul,
    tmp;
  cb = cb || function () {};
  opt = opt || {};
  opt.item = opt.item || item;
  if ((soul = ((item || "")._ || "")["#"])) {
    (item = {})["#"] = soul;
  } // check if node, make link.
  if ("string" == typeof (tmp = Zen.valid(item))) {
    return zen.get((soul = tmp)).put(item, cb, opt);
  } // check if link
  if (!Zen.is(item)) {
    if (Object.plain(item)) {
      item = root.get((soul = zen.back("opt.uuid")())).put(item);
    }
    return zen.get(soul || root.back("opt.uuid")(7)).put(item, cb, opt);
  }
  zen.put(function (go) {
    item.get(function (soul, o, msg) {
      // TODO: BUG! We no longer have this option? & go error not handled?
      if (!soul) {
        return cb.call(zen, {
          err: Zen.log('Only a node can be linked! Not "' + msg.put + '"!'),
        });
      }
      (tmp = {})[soul] = { "#": soul };
      go(tmp);
    }, true);
  });
  return item;
};
