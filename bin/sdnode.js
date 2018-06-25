//
// This is a basic router example
//
// This script runs a simple WAMP router on port 9000
// It illustrates:
// - how to filter out incoming connections,
// - how to declare a router-embedded RPC,
// - how to subscribe to router events.
//

WAMPRT_TRACE = true;

var MSG = require('../lib/messages');
var WampRouter = require('../lib/fox-wamp');
var DNode = require('../lib/dnode/starter');
var program = require('commander');

program
  .option('-p, --port <port>', 'Server IP port', 9000)
  .parse(process.argv);

console.log('Listening port:', program.port);

var app = new WampRouter(
    {port: program.port}
);

app.getRealm('realm1', function (realm) {
    var api = realm.api();
    api.regrpc('test.foo', function(id, args, kwargs) {
        console.log('called with ', args, kwargs);
        api.resrpc(id, null /* no error */, ["bar", "bar2"], {"key1": "bar1", "key2": "bar2"});
    });
});

var dnode_server = DNode(function (remote, conn) {
    this.zing = function (n, cb) { cb(n * 100) };
    this.mtr = function (n, cb) { cb('MTR result') };
});

dnode_server.listen(7070);
