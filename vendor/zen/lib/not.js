import ZEN from "../zen.js";
var Zen = ZEN;

var u;

Zen.chain.not = function (cb, opt, t) {
  return this.get(ought, { not: cb });
};

function ought(at, ev) {
  ev.off();
  if (at.err || u !== at.put) {
    return;
  }
  if (!this.not) {
    return;
  }
  this.not.call(at.zen, at.get, function () {
    console.log(
      "Please report this bug on https://gitter.im/akaoio/zen and in the issues.",
    );
    need.to.implement;
  });
}
