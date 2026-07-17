import Zen from "../zen.js";
import url from "url";

export default function (req, res, next) {
  next = next || function () {}; // if not next, and we don't handle it, we should res.end
  if (!req || !res) {
    return next();
  }
  if (!req.url) {
    return next();
  }
  if (!req.method) {
    return next();
  }
  var msg = {};
  msg.url = url.parse(req.url, true);
  msg.method = (req.method || "").toLowerCase();
  msg.headers = req.headers;
  var u;
  var post = function (err, body) {
    if (u !== body) {
      msg.body = body;
    }
    next(msg, function (reply) {
      if (!res) {
        return;
      }
      if (!reply) {
        return res.end();
      }
      if (Zen.obj.has(reply, "statusCode") || Zen.obj.has(reply, "status")) {
        res.statusCode = reply.statusCode || reply.status;
      }
      if (reply.headers) {
        if (
          !(
            res.headersSent ||
            res.headerSent ||
            res._headerSent ||
            res._headersSent
          )
        ) {
          Zen.obj.map(reply.headers, function (val, field) {
            if (val !== 0 && !val) {
              return;
            }
            res.setHeader(field, val);
          });
        }
      }
      if (Zen.obj.has(reply, "chunk") || Zen.obj.has(reply, "write")) {
        res.write(Zen.text.ify(reply.chunk || reply.write) || "");
      }
      if (Zen.obj.has(reply, "body") || Zen.obj.has(reply, "end")) {
        res.end(Zen.text.ify(reply.body || reply.end) || "");
      }
    });
  };
  if (req.method === "GET" || req.method === "HEAD") {
    post(null);
    return;
  }
  readBody(req, function (err, raw) {
    if (err) {
      post(err);
      return;
    }
    try {
      post(null, parseBody(req.headers, raw));
    } catch (parseErr) {
      post(parseErr);
    }
  });
}

function readBody(req, cb) {
  var chunks = [];
  req.on("data", function (chunk) {
    chunks.push(Buffer.from(chunk));
  });
  req.on("end", function () {
    cb(null, Buffer.concat(chunks).toString("utf8"));
  });
  req.on("error", cb);
}

function parseBody(headers, raw) {
  if (!raw) {
    return;
  }
  var type = ((headers || {})["content-type"] || "")
    .split(";")[0]
    .trim()
    .toLowerCase();
  if (!type) {
    return raw;
  }
  if (type === "application/json") {
    return Zen.obj.ify(raw);
  }
  if (type === "application/x-www-form-urlencoded") {
    return parseUrlEncoded(raw);
  }
  if (type === "multipart/form-data") {
    return parseMultipart(headers, raw);
  }
  if (type === "text/plain") {
    return raw;
  }
  return raw;
}

function parseUrlEncoded(raw) {
  var data = {};
  new URLSearchParams(raw).forEach(function (value, key) {
    assignField(data, key, value);
  });
  return Object.keys(data).length ? data : undefined;
}

function parseMultipart(headers, raw) {
  var type = (headers || {})["content-type"] || "";
  var match = type.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!match) {
    return;
  }
  var boundary = "--" + (match[1] || match[2] || "").trim();
  if (!boundary || boundary === "--") {
    return;
  }
  var data = {};
  raw.split(boundary).forEach(function (part) {
    part = part.trim();
    if (!part || part === "--") {
      return;
    }
    var splitAt = part.indexOf("\r\n\r\n");
    if (splitAt < 0) {
      splitAt = part.indexOf("\n\n");
    }
    if (splitAt < 0) {
      return;
    }
    var headerText = part.slice(0, splitAt);
    var body = part
      .slice(splitAt + (part[splitAt] === "\r" ? 4 : 2))
      .replace(/\r?\n--$/, "")
      .replace(/\r?\n$/, "");
    var disposition = headerText.match(
      /content-disposition:[^\n]*name="([^"]+)"/i,
    );
    if (!disposition) {
      return;
    }
    if (/filename="/i.test(headerText)) {
      return;
    } // files not supported in zen yet
    assignField(data, disposition[1], body);
  });
  return Object.keys(data).length ? data : undefined;
}

function assignField(target, key, value) {
  if (!Object.prototype.hasOwnProperty.call(target, key)) {
    target[key] = value;
    return;
  }
  if (!(target[key] instanceof Array)) {
    target[key] = [target[key]];
  }
  target[key].push(value);
}
