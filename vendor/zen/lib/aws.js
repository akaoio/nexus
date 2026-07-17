import { normalizeS3Config, S3Client } from "./s3.js";
import ZEN from "../zen.js";

export default (function (a) {
  function s3(opt) {
    if (!(this instanceof s3)) {
      return new s3(opt);
    }
    opt = normalizeS3Config(opt || {});
    if (!opt.accessKeyId || !opt.secretAccessKey) {
      return 0;
    }
    this.config = opt;
    this.on = a.on;
    this.client = new S3Client(opt);
    return this;
  }
  s3.id = function (m) {
    return m.Bucket + "/" + m.Key;
  };
  s3.chain = s3.prototype;
  s3.chain.S3 = function () {
    return this.client;
  };
  s3.chain.PUT = function (key, o, cb, m) {
    if (!key) {
      return;
    }
    m = m || {};
    m.Bucket = m.Bucket || this.config.bucket;
    m.Key = m.Key || key;
    if (a.obj.is(o) || a.list.is(o)) {
      m.Body = a.text.ify(o);
      m.ContentType = "application/json";
    } else {
      m.Body = a.text.is(o) ? o : a.text.ify(o);
    }
    this.S3().putObject(m, function (e, r) {
      if (!cb) {
        return;
      }
      cb(e, r);
    });
    return this;
  };
  s3.chain.GET = function (key, cb, o) {
    if (!key) {
      return;
    }
    var s = this,
      m = { Bucket: s.config.bucket, Key: key },
      id = s3.id(m);
    s.on(id, function (arg) {
      var e = arg[0],
        d = arg[1],
        t = arg[2],
        m = arg[3],
        r = arg[4];
      this.off();
      delete s.batch[id];
      if (!a.fn.is(cb)) {
        return;
      }
      try {
        cb(e, d, t, m, r);
      } catch (e) {
        console.log(e);
      }
    });
    s.batch = s.batch || {};
    if (s.batch[id]) {
      return s;
    }
    s.batch[id] = (s.batch[id] || 0) + 1;
    s.S3().getObject(m, function (e, r) {
      var d, t, m;
      if (e || !r) {
        return s.on(id, [e]);
      }
      r.Text = r.text = t = (r.Body || r.body || "").toString("utf8");
      r.Type = r.type = r.ContentType || (r.headers || {})["content-type"];
      if (r.type && "application/json" === r.type) {
        d = a.obj.ify(t);
      }
      m = r.Metadata;
      s.on(id, [e, d, t, m, r]);
    });
    return s;
  };
  s3.chain.del = function (key, cb) {
    if (!key) {
      return;
    }
    var m = { Bucket: this.config.bucket, Key: key };
    this.S3().deleteObject(m, function (e, r) {
      if (!cb) {
        return;
      }
      cb(e, r);
    });
    return this;
  };
  s3.chain.dbs = function (o, cb) {
    cb = cb || o;
    this.S3().listBuckets({}, function (e, r) {
      a.list.map((r || {}).Buckets, function (v) {
        console.log(v);
      });
      if (!a.fn.is(cb)) {
        return;
      }
      cb(e, r);
    });
    return this;
  };
  s3.chain.keys = function (from, upto, cb) {
    cb = cb || upto || from;
    var m = { Bucket: this.config.bucket };
    if (a.text.is(from)) {
      m.Prefix = from;
    }
    if (a.text.is(upto)) {
      m.Delimiter = upto;
    }
    this.S3().listObjects(m, function (e, r) {
      a.list.map((r || {}).Contents, function (v) {
        console.log(v);
      });
      if (!a.fn.is(cb)) {
        return;
      }
      cb(e, r);
    });
    return this;
  };
  return s3;
})(ZEN);
