import ZEN from "../zen.js";
var Zen = ZEN;

/*
 * Function promOnce
 * @param limit - due to promises resolving too fast if we do not set a timer
 *  we will not be able receive any data back from zen before returning the promise
 *  works both following a Chain.get and a Chain.map (limit only applies to map)
 *  If no limit is chosen, defaults to 100 ms (quite sufficient to fetch about 2000 nodes or more)
 * @param opt - option object
 * @return {ref: gunReference, data: object / string (data), key: string (soulOfData)}
 */

Zen.chain.promOnce = async function (limit, opt) {
  var zen = this,
    cat = zen._;
  if (!limit) {
    limit = 100;
  }
  if (cat.subs) {
    var array = [];
    zen.map().once((data, key) => {
      var zen = this;
      array.push(
        new Promise((res, rej) => {
          res({ ref: zen, data: data, key: key });
        }),
      );
    }, opt);
    await sleep(limit);
    return Promise.all(array);
  } else {
    return new Promise((res, rej) => {
      zen.once(function (data, key) {
        var zen = this;
        res({ ref: zen, data: data, key: key });
      }, opt);
    });
  }
  var chain = zen.chain();
  return chain;
};

function sleep(limit) {
  return new Promise((res, rej) => {
    setTimeout(res, limit);
  });
}

/*
 * Function promPut
 * @param item (string / object) - item to be put to that key in the chain
 * @param opt - option object
 * @return object - Returns an object with the ref to that node that was just
 *  created as well as the 'ack' which acknowledges the put was successful
 *  object {ref: gunReference, ack: acknowledgmentObject}
 * If put had an error we can catch the return via .catch
 */

Zen.chain.promPut = async function (item, opt) {
  var zen = this;
  return new Promise((res, rej) => {
    zen.put(
      item,
      function (ack) {
        if (ack.err) {
          console.log(ack.err);
          ack.ok = -1;
          res({ ref: zen, ack: ack });
        }
        res({ ref: zen, ack: ack });
      },
      opt,
    );
  });
};

/*
 * Function promSet
 * @param item (string / object) - item to be set into a list at this key
 * @param opt - option object
 * @return object - Returns object with the ref to that node that was just
 *  created as well as the 'ack' which acknowledges the set was successful
 *  object {ref: gunReference, ack: acknowledgmentObject}
 * If set had an error we can catch the return via .catch
 */

Zen.chain.promSet = async function (item, opt) {
  var zen = this,
    soul;
  var cb = cb || function () {};
  opt = opt || {};
  opt.item = opt.item || item;
  return new Promise(async function (res, rej) {
    if ((soul = Zen.node.soul(item))) {
      item = Zen.obj.put({}, soul, Zen.val.link.ify(soul));
    }
    if (!Zen.is(item)) {
      if (Zen.obj.is(item)) {
        item = await zen
          .back(-1)
          .get((soul = soul || Zen.node.soul(item) || zen.back("opt.uuid")()))
          .promPut(item);
        item = item.ref;
      }
      res(zen.get(soul || Zen.state.lex() + Zen.text.random(7)).promPut(item));
    }
    item.get(function (soul, o, msg) {
      var ack = {};
      if (!soul) {
        rej({
          ack: {
            err: Zen.log('Only a node can be linked! Not "' + msg.put + '"!'),
          },
        });
      }
      zen.put(Zen.obj.put({}, soul, Zen.val.link.ify(soul)), cb, opt);
    }, true);
    res({ ref: item, ack: { ok: 0 } });
  });
};

/*
 * Function promOn
 * @param callback (function) - function to be called upon changes to data
 * @param option (object) - {change: true} only allow changes to trigger the callback
 * @return - data and key
 * subscribes callback to data
 */

Zen.chain.promOn = async function (callback, option) {
  var zen = this;
  return new Promise((res, rej) => {
    zen.on(function (data, key) {
      callback(data, key);
      res(data, key);
    }, option);
  });
};
