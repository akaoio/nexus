// Shared error-handling helpers for async crypto functions.

function cryptoErr(e, cb) {
  if (cb) {
    try {
      cb();
    } catch (x) {
      console.log(x);
    }
    return;
  }
  throw e;
}

function cbOk(cb, val) {
  if (cb) {
    try {
      cb(val);
    } catch (x) {
      console.log(x);
    }
  }
  return val;
}

export { cryptoErr, cbOk };
