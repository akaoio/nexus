function ensureJsonAsync() {
  JSON.parseAsync =
    JSON.parseAsync ||
    function (text, cb, reviver) {
      try {
        cb(undefined, JSON.parse(text, reviver));
      } catch (error) {
        cb(error);
      }
    };
  JSON.stringifyAsync =
    JSON.stringifyAsync ||
    function (value, cb, replacer, space) {
      try {
        cb(undefined, JSON.stringify(value, replacer, space));
      } catch (error) {
        cb(error);
      }
    };
}

function parseAsync(text, cb, reviver) {
  ensureJsonAsync();
  return JSON.parseAsync(text, cb, reviver);
}

function stringifyAsync(value, cb, replacer, space) {
  ensureJsonAsync();
  return JSON.stringifyAsync(value, cb, replacer, space);
}

function createJsonPair(note) {
  const mark = typeof note === "function" ? note : function () {};
  return {
    parse: function (text, cb, reviver) {
      const started = +new Date();
      return parseAsync(
        text,
        function (error, raw) {
          cb(error, raw, mark(+new Date() - started));
        },
        reviver,
      );
    },
    json: function (value, cb, replacer, space) {
      const started = +new Date();
      return stringifyAsync(
        value,
        function (error, raw) {
          cb(error, raw, mark(+new Date() - started));
        },
        replacer,
        space,
      );
    },
  };
}

export default { ensureJsonAsync, parseAsync, stringifyAsync, createJsonPair };
