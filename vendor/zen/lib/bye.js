import ZEN from "../zen.js";
var Zen = ZEN;

Zen.on("create", function (root) {
  this.to.next(root);
  var mesh = root.opt.mesh;
  if (!mesh) {
    return;
  }
  mesh.hear["bye"] = function (msg, peer) {
    (peer.byes = peer.byes || []).push(msg.bye);
  };
  root.on("bye", function (peer) {
    this.to.next(peer);
    if (!peer.byes) {
      return;
    }
    var zen = root.$;
    Zen.obj.map(peer.byes, function (data) {
      Zen.obj.map(data, function (put, soul) {
        zen.get(soul).put(put);
      });
    });
    peer.byes = [];
  });
});

Zen.chain.bye = function () {
  var zen = this,
    bye = zen.chain(),
    root = zen.back(-1),
    put = bye.put;
  bye.put = function (data) {
    zen.back(function (at) {
      if (!at.get) {
        return;
      }
      var tmp = data;
      (data = {})[at.get] = tmp;
    });
    root.on("out", { bye: data });
    return zen;
  };
  return bye;
};
