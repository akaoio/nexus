import ZEN from "../zen.js";
{
  var Zen = ZEN;

  Zen.on("opt", function (root) {
    once(root);
    this.to.next(root);
  });

  function once(root) {
    if (root.once) {
      return;
    }
    var forget = (root.opt.forget = root.opt.forget || {});
    root.on("put", function (msg) {
      Zen.graph.is(msg.put, function (node, soul) {
        if (!Zen.obj.has(forget, soul)) {
          return;
        }
        delete msg.put[soul];
      });
      this.to.next(msg);
    });
  }
}
