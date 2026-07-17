let __defaultExport;
function Rmem() {
  var opt = {},
    store = {},
    u;
  opt.put = function (file, data, cb) {
    //setTimeout(function(){ // make async
    store[file] = data;
    cb(null, 1);
    //}, 1);
  };
  opt.get = function (file, cb) {
    //setTimeout(function(){ // make async
    var tmp = store[file] || u;
    cb(null, tmp);
    //}, 1);
  };
  return opt;
}

try {
  __defaultExport = Rmem;
} catch (e) {}
export default __defaultExport;
