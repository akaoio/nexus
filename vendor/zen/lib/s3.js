import { createHash, createHmac } from "node:crypto";

const EMPTY_HASH = sha256Hex("");

export function normalizeS3Config(opt = {}) {
  const config = { ...opt };
  config.bucket = config.bucket || config.Bucket || process.env.AWS_S3_BUCKET;
  config.region = config.region || process.env.AWS_REGION || "us-east-1";
  config.accessKeyId = config.key =
    config.key || config.accessKeyId || process.env.AWS_ACCESS_KEY_ID;
  config.secretAccessKey = config.secret =
    config.secret ||
    config.secretAccessKey ||
    process.env.AWS_SECRET_ACCESS_KEY;
  config.sessionToken = config.sessionToken || process.env.AWS_SESSION_TOKEN;
  if ((config.fakes3 = config.fakes3 || process.env.fakes3)) {
    config.endpoint = config.endpoint || config.fakes3;
    config.sslEnabled = false;
    if (config.bucket) {
      config.bucket = config.bucket.replace(".", "p");
    }
  }
  config.endpoint = normalizeEndpoint(config.endpoint, config.sslEnabled);
  return config;
}

export class S3Client {
  constructor(opt = {}) {
    this.config = normalizeS3Config(opt);
  }

  putObject(params, cb) {
    return callbackify(this._putObject(params), cb);
  }
  getObject(params, cb) {
    return callbackify(this._getObject(params), cb);
  }
  deleteObject(params, cb) {
    return callbackify(this._deleteObject(params), cb);
  }
  listBuckets(params, cb) {
    return callbackify(this._listBuckets(params), cb);
  }
  listObjects(params, cb) {
    return callbackify(this._listObjects(params), cb);
  }
  listObjectsV2(params, cb) {
    return callbackify(this._listObjectsV2(params), cb);
  }

  async _putObject(params = {}) {
    const response = await this._request("PUT", params.Bucket, params.Key, {
      body: params.Body,
      headers: withMetadata(
        {
          "content-type": params.ContentType,
        },
        params.Metadata,
      ),
    });
    return {
      ETag: response.headers.get("etag") || "",
      VersionId: response.headers.get("x-amz-version-id") || "",
    };
  }

  async _getObject(params = {}) {
    const response = await this._request("GET", params.Bucket, params.Key);
    const body = Buffer.from(await response.arrayBuffer());
    return {
      Body: body,
      ContentType: response.headers.get("content-type") || "",
      Metadata: metadataFromHeaders(response.headers),
      headers: headersToObject(response.headers),
    };
  }

  async _deleteObject(params = {}) {
    const response = await this._request("DELETE", params.Bucket, params.Key);
    return {
      DeleteMarker: response.headers.get("x-amz-delete-marker") === "true",
      VersionId: response.headers.get("x-amz-version-id") || "",
    };
  }

  async _listBuckets() {
    const response = await this._request("GET");
    const xml = await response.text();
    return {
      Buckets: collect(xml, "Bucket").map(function (bucket) {
        return {
          Name: first(bucket, "Name") || "",
          CreationDate: first(bucket, "CreationDate") || "",
        };
      }),
    };
  }

  async _listObjects(params = {}) {
    const query = {};
    if (params.Prefix) {
      query.prefix = params.Prefix;
    }
    if (params.Delimiter) {
      query.delimiter = params.Delimiter;
    }
    if (params.Marker) {
      query.marker = params.Marker;
    }
    if (params.MaxKeys) {
      query["max-keys"] = params.MaxKeys;
    }
    const response = await this._request("GET", params.Bucket, "", { query });
    const xml = await response.text();
    return parseList(xml, false);
  }

  async _listObjectsV2(params = {}) {
    const query = { "list-type": "2" };
    if (params.Prefix) {
      query.prefix = params.Prefix;
    }
    if (params.Delimiter) {
      query.delimiter = params.Delimiter;
    }
    if (params.ContinuationToken) {
      query["continuation-token"] = params.ContinuationToken;
    }
    if (params.MaxKeys) {
      query["max-keys"] = params.MaxKeys;
    }
    const response = await this._request("GET", params.Bucket, "", { query });
    const xml = await response.text();
    return parseList(xml, true);
  }

  async _request(method, bucket, key, options = {}) {
    const config = this.config;
    const body = bodyBuffer(options.body);
    const payloadHash = sha256Hex(body);
    const now = options.now || new Date();
    const amzDate = toAmzDate(now);
    const shortDate = amzDate.slice(0, 8);
    const url = buildUrl(
      config,
      bucket || config.bucket,
      key || "",
      options.query,
    );
    const host = url.host;
    const headers = lowerCaseHeaders(options.headers);
    headers.host = host;
    headers["x-amz-content-sha256"] = payloadHash;
    headers["x-amz-date"] = amzDate;
    if (config.sessionToken) {
      headers["x-amz-security-token"] = config.sessionToken;
    }
    const signedHeaders = Object.keys(headers).sort();
    const canonicalRequest = [
      method,
      canonicalUri(url.pathname),
      canonicalQuery(url.searchParams),
      signedHeaders
        .map((name) => name + ":" + trimHeader(headers[name]))
        .join("\n") + "\n",
      signedHeaders.join(";"),
      payloadHash,
    ].join("\n");
    const credentialScope = [
      shortDate,
      config.region,
      "s3",
      "aws4_request",
    ].join("/");
    const stringToSign = [
      "AWS4-HMAC-SHA256",
      amzDate,
      credentialScope,
      sha256Hex(canonicalRequest),
    ].join("\n");
    const signingKey = signKey(
      config.secretAccessKey || "",
      shortDate,
      config.region,
      "s3",
    );
    headers.authorization = [
      "AWS4-HMAC-SHA256 Credential=" +
        config.accessKeyId +
        "/" +
        credentialScope,
      "SignedHeaders=" + signedHeaders.join(";"),
      "Signature=" + hmacHex(signingKey, stringToSign),
    ].join(", ");

    const response = await fetch(url, {
      method,
      headers,
      body: method === "GET" || method === "HEAD" ? undefined : body,
    });
    if (response.ok) {
      return response;
    }
    throw await s3Error(response);
  }
}

function callbackify(promise, cb) {
  if (typeof cb !== "function") {
    return promise;
  }
  promise.then(
    (result) => cb(null, result),
    (error) => cb(error),
  );
}

function buildUrl(config, bucket, key, query) {
  const base = config.endpoint || defaultEndpoint(config.region);
  const url = new URL(base);
  const encodedKey = encodeKey(key);
  url.pathname = [
    url.pathname.replace(/\/+$/, ""),
    encodeURIComponent(bucket || ""),
    encodedKey,
  ]
    .filter(Boolean)
    .join("/");
  if (url.pathname[0] !== "/") {
    url.pathname = "/" + url.pathname;
  }
  Object.keys(query || {})
    .sort()
    .forEach(function (name) {
      if (query[name] !== undefined && query[name] !== null) {
        url.searchParams.set(name, query[name]);
      }
    });
  return url;
}

function defaultEndpoint(region) {
  return region === "us-east-1"
    ? "https://s3.amazonaws.com"
    : "https://s3." + region + ".amazonaws.com";
}

function normalizeEndpoint(endpoint, sslEnabled) {
  if (!endpoint) {
    return endpoint;
  }
  if (/^https?:\/\//i.test(endpoint)) {
    return endpoint;
  }
  return (sslEnabled === false ? "http://" : "https://") + endpoint;
}

function bodyBuffer(body) {
  if (body === undefined || body === null) {
    return Buffer.alloc(0);
  }
  if (Buffer.isBuffer(body)) {
    return body;
  }
  if (body instanceof Uint8Array) {
    return Buffer.from(body);
  }
  return Buffer.from("" + body);
}

function lowerCaseHeaders(headers) {
  const out = {};
  Object.keys(headers || {}).forEach(function (name) {
    const value = headers[name];
    if (value !== undefined && value !== null) {
      out[name.toLowerCase()] = value;
    }
  });
  return out;
}

function withMetadata(headers, metadata) {
  const out = { ...headers };
  Object.keys(metadata || {}).forEach(function (name) {
    out["x-amz-meta-" + name.toLowerCase()] = metadata[name];
  });
  return out;
}

function metadataFromHeaders(headers) {
  const metadata = {};
  headers.forEach(function (value, name) {
    if (name.startsWith("x-amz-meta-")) {
      metadata[name.slice(11)] = value;
    }
  });
  return metadata;
}

function headersToObject(headers) {
  const out = {};
  headers.forEach(function (value, name) {
    out[name] = value;
  });
  return out;
}

function canonicalUri(pathname) {
  return pathname
    .split("/")
    .map(function (part) {
      return encodeRfc3986(decodeURIComponent(part || ""));
    })
    .join("/");
}

function canonicalQuery(searchParams) {
  const pairs = [];
  searchParams.forEach(function (value, key) {
    pairs.push([encodeRfc3986(key), encodeRfc3986(value)]);
  });
  pairs.sort(function (a, b) {
    if (a[0] === b[0]) {
      return a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0;
    }
    return a[0] < b[0] ? -1 : 1;
  });
  return pairs
    .map(function (pair) {
      return pair[0] + "=" + pair[1];
    })
    .join("&");
}

function encodeKey(key) {
  return ("" + (key || "")).split("/").map(encodeRfc3986).join("/");
}

function encodeRfc3986(value) {
  return encodeURIComponent("" + value).replace(/[!'()*]/g, function (ch) {
    return "%" + ch.charCodeAt(0).toString(16).toUpperCase();
  });
}

function trimHeader(value) {
  return ("" + value).trim().replace(/\s+/g, " ");
}

function toAmzDate(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key, value) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function signKey(secret, date, region, service) {
  let key = Buffer.from("AWS4" + secret, "utf8");
  key = hmac(key, date);
  key = hmac(key, region);
  key = hmac(key, service);
  key = hmac(key, "aws4_request");
  return key;
}

async function s3Error(response) {
  const text = await response.text();
  const error = new Error(
    first(text, "Message") || response.statusText || "S3 request failed",
  );
  error.code = first(text, "Code") || response.status;
  error.statusCode = response.status;
  error.body = text;
  return error;
}

function parseList(xml, v2) {
  return {
    IsTruncated: /^true$/i.test(first(xml, "IsTruncated") || ""),
    NextContinuationToken: v2 ? first(xml, "NextContinuationToken") || "" : "",
    Contents: collect(xml, "Contents").map(function (entry) {
      return {
        Key: first(entry, "Key") || "",
        LastModified: first(entry, "LastModified") || "",
        ETag: first(entry, "ETag") || "",
        Size: parseInt(first(entry, "Size") || "0", 10),
        StorageClass: first(entry, "StorageClass") || "",
      };
    }),
  };
}

function collect(xml, tag) {
  const regex = new RegExp(
    "<" + tag + "(?:>| [^>]*>)([\\s\\S]*?)<\\/" + tag + ">",
    "g",
  );
  const values = [];
  let match;
  while ((match = regex.exec(xml || ""))) {
    values.push(decodeXml(match[1]));
  }
  return values;
}

function first(xml, tag) {
  return collect(xml, tag)[0];
}

function decodeXml(value) {
  return (value || "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

export { EMPTY_HASH };
