import ZEN from "../zen.js";
import __index from "../index.js";
var Zen = Zen || ZEN;

Zen.chain.list = function (cb, opt) {
  opt = opt || {};
  cb = cb || function () {};
  var zen = this.put({}); // insert assumes a graph node. So either create it or merge with the existing one.
  zen.last = function (obj, cb) {
    var last = zen.path("last");
    if (!arguments.length) {
      return last;
    }
    return zen
      .path("last")
      .put(null)
      .put(obj)
      .val(function (val) {
        // warning! these are not transactional! They could be.
        console.log("last is", val);
        last.path("next").put(this._.node, cb);
      });
  };
  zen.first = function (obj, cb) {
    var first = zen.path("first");
    if (!arguments.length) {
      return first;
    }
    return zen
      .path("first")
      .put(null)
      .put(obj)
      .val(function () {
        // warning! these are not transactional! They could be.
        first.path("prev").put(this._.node, cb);
      });
  };
  return zen;
};

if (false) {
  // list tests
  var Zen = __index;
  var zen = Zen({ file: "data.json" });
  Zen.log.verbose = true;

  var list = zen.list();
  list.last({ name: "Mark Nadal", type: "human", age: 23 }).val(function (val) {
    //console.log("oh yes?", val, '\n', this.__.graph);
  });
  list.last({ name: "Timber Nadal", type: "cat", age: 3 }).val(function (val) {
    //console.log("oh yes?", val, '\n', this.__.graph);
  });
  list
    .list()
    .last({ name: "Hobbes", type: "kitten", age: 4 })
    .val(function (val) {
      //console.log("oh yes?", val, '\n', this.__.graph);
    });
  list
    .list()
    .last({ name: "Skid", type: "kitten", age: 2 })
    .val(function (val) {
      //console.log("oh yes?", val, '\n', this.__.graph);
    });
  setTimeout(function () {
    list.val(function (val) {
      console.log("the list!", list.__.graph);
      return;
      list
        .path("first")
        .val(Zen.log)
        .path("next")
        .val(Zen.log)
        .path("next")
        .val(Zen.log);
    });
  }, 1000);

  if (false) {
    zen.list().map(function (val, id) {
      console.log("each!", id, val);
    });
  }
}
