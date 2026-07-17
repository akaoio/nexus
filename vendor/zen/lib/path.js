import ZEN from "../zen.js";
var Zen = ZEN;

Zen.chain.path = function (field, opt) {
  var back = this,
    zen = back,
    tmp;
  if (typeof field === "string") {
    tmp = field.split(opt || ".");
    if (1 === tmp.length) {
      zen = back.get(field);
      return zen;
    }
    field = tmp;
  }
  if (field instanceof Array) {
    if (field.length > 1) {
      zen = back;
      var i = 0,
        l = field.length;
      for (i; i < l; i++) {
        //zen = zen.get(field[i], (i+1 === l)? cb : null, opt);
        zen = zen.get(field[i]);
      }
    } else {
      zen = back.get(field[0]);
    }
    return zen;
  }
  if (!field && 0 != field) {
    return back;
  }
  zen = back.get("" + field);
  return zen;
};
