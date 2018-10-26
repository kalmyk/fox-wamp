var MSG = require('../lib/messages');
var Router = require('../index');
var program = require('commander');

program
  .option('-p, --port <port>', 'Server IP port', 9000)
  .parse(process.argv);

var app = new Router();
app.setLogTrace(true);

app.on('RPCRegistered', function (realm, uri) {
    console.log('onRPCRegistered RPC registered', uri);
});
app.on('RPCUnregistered', function (realm, uri) {
    console.log('onRPCUnregistered RPC unregistered', uri);
});
app.on(MSG.REALM_CREATED, function (realm, realmName) {
    console.log('new Relm:', realmName);
});

app.getRealm('realm1', function (realm) {
    var api = realm.api();
    api.regrpc('test.foo', function(id, args, kwargs) {
        console.log('called with ', args, kwargs);
        api.resrpc(id, null /* no error */, ["bar", "bar2"], {"key1": "bar1", "key2": "bar2"});
    });
});

console.log('Listening port:', program.port);
app.listenWAMP({port: program.port});
