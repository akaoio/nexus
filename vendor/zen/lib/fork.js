import ZEN from "../zen.js";
/*
describe('API Chain Features', function(){

    describe('Zen.chain.fork', function(){
        var zen = Zen();
        var fork;
        it('create fork', function(done){
            fork = zen.fork().wire();
            done();
        });			
        it('put data via fork', function(done){								
            fork.get("fork-test").get("fork").put("test123").once(()=>done());				
        });			
        it('get data via main', function(done){								
            zen.get("fork-test").get("fork").once((data)=>{
                expect(data).to.be("test123");
                done();
            });				
        });			
        it('put data via main', function(done){								
            zen.get("fork-test").get("main").put("test321").once(()=>done());				
        });			
        it('get data via fork', function(done){								
            fork.get("fork-test").get("main").once((data)=>{
                expect(data).to.be("test321");
                done();
            });				
        });
    })

})
*/
(function (Zen, u) {
  /**
   *
   *  credits:
   *      github:bmatusiak
   *
   */
  Zen.chain.fork = function (g) {
    var zen = this._;
    var w = {},
      mesh = () => {
        var root = zen.root,
          opt = root.opt;
        return opt.mesh || Zen.Mesh(root);
      };
    w.link = function () {
      if (this._l) return this._l;
      this._l = {
        send: (msg) => {
          if (!this.l || !this.l.onmessage) throw "not attached";
          this.l.onmessage(msg);
        },
      };
      return this._l;
    };
    w.attach = function (l) {
      if (this.l) throw "already attached";
      var peer = { wire: l };
      l.onmessage = function (msg) {
        mesh().hear(msg.data || msg, peer);
      };
      mesh().hi((this.l = l && peer));
    };
    w.wire = function (opts) {
      var f = new Zen(opts);
      f.fork(w);
      return f;
    };
    if (g) {
      w.attach(g.link());
      g.attach(w.link());
    }
    return w;
  };
})(ZEN);
