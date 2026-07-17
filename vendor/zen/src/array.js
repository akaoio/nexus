import "./base64.js";

// This is Array extended to have .toString(['utf8'|'hex'|'base64'])
function ZenArray() {}
Object.assign(ZenArray, { from: Array.from });
ZenArray.prototype = Object.create(Array.prototype);
ZenArray.prototype.toString = function (enc, start, end) {
  enc = enc || "utf8";
  start = start || 0;
  const length = this.length;
  if (enc === "hex") {
    const buf = new Uint8Array(this);
    return [...Array(((end && end + 1) || length) - start).keys()]
      .map((i) => buf[i + start].toString(16).padStart(2, "0"))
      .join("");
  }
  if (enc === "utf8") {
    return Array.from({ length: (end || length) - start }, (_, i) =>
      String.fromCharCode(this[i + start]),
    ).join("");
  }
  if (enc === "base64") {
    return btoa(this);
  }
};

export default ZenArray;
