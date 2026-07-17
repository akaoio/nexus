import ZEN from "../zen.js";
import __open from "./open.js";
var Zen = ZEN;
Zen.chain.open || __open;

Zen.chain.load = function (cb, opt, at) {
  (opt = opt || {}).off = !0;
  return this.open(cb, opt, at);
};
