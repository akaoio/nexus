import ZEN from "../zen.js";
{
  var Zen = ZEN;
  Zen.state.node = function (node, vertex, opt) {
    opt = opt || {};
    opt.state = opt.state || Zen.state();
    var now = Zen.obj.copy(vertex);
    Zen.node.is(node, function (val, key) {
      var ham = Zen.HAM(
        opt.state,
        Zen.state.is(node, key),
        Zen.state.is(vertex, key),
        val,
        vertex[key],
      );
      if (!ham.incoming) {
        // if(ham.defer){}
        return;
      }
      now = Zen.state.to(node, key, now);
    });
    return now;
  };
}
