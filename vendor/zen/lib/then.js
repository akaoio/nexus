import ZEN from "../zen.js";
var Zen = ZEN;

// Returns a zen reference in a promise and then calls a callback if specified
Zen.chain.promise = function (cb) {
  var zen = this,
    cb =
      cb ||
      function (ctx) {
        return ctx;
      };
  return new Promise(function (res, rej) {
    zen.once(function (data, key) {
      res({ put: data, get: key, zen: this }); // zen reference is returned by promise
    });
  }).then(cb); //calling callback with resolved data
};

// Returns a promise for the data, key of the zen call
Zen.chain.then = function (cb) {
  var zen = this;
  var p = new Promise((res, rej) => {
    zen.once(function (data, key) {
      res(data, key); //call resolve when data is returned
    });
  });
  return cb ? p.then(cb) : p;
};
