import ZEN from "../zen.js";
import __open from "./open.js";
var Zen = Zen || ZEN;
Zen.chain.open || __open;

Zen.chain.later = function (cb, age) {
  var zen = this;
  age = age * 1000; // convert to milliseconds.
  setTimeout(function () {
    zen.open(cb, { off: true });
  }, age);
  return zen;
};
