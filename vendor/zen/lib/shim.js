import ZEN from "../zen.js";
import __open from "./open.js";
import __bye from "./bye.js";
var Zen = ZEN;

Zen.chain.open || __open;

var _on = Zen.chain.on;
Zen.chain.on = function (a, b, c) {
  if ("value" === a) {
    return this.open(b, c);
  }
  return _on.call(this, a, b, c);
};

Zen.chain.bye || __bye;
Zen.chain.onDisconnect = Zen.chain.bye;
Zen.chain.connected = function (cb) {
  var root = this.back(-1),
    last;
  root.on("hi", function (peer) {
    if (!cb) {
      return;
    }
    cb((last = true), peer);
  });
  root.on("bye", function (peer) {
    if (!cb || last === peer) {
      return;
    }
    cb(false, (last = peer));
  });
  return this;
};
