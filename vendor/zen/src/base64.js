// Patch root.btoa/root.atob to use URL-safe base64 (no +//, no padding).
// Native btoa/atob are available in all modern browsers and Node.js 16+.

var root =
  typeof globalThis !== "undefined"
    ? globalThis
    : typeof global !== "undefined"
      ? global
      : typeof window !== "undefined"
        ? window
        : this;
var nativeBtoa = root.btoa && root.btoa.bind(root);
var nativeAtob = root.atob && root.atob.bind(root);
if (nativeBtoa) {
  root.btoa = function (data) {
    return nativeBtoa(data)
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");
  };
}
if (nativeAtob) {
  root.atob = function (data) {
    var tmp = data.replace(/-/g, "+").replace(/_/g, "/");
    while (tmp.length % 4) {
      tmp += "=";
    }
    return nativeAtob(tmp);
  };
}
