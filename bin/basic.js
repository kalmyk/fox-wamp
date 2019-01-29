var MSG = require('../lib/messages');
var Router = require('../index');
var program = require('commander');

program
  .option('-p, --port <port>', 'Server IP port', 9000)
  .parse(process.argv);

var app = new Router();
app.setLogTrace(true);

app.on(MSG.ON_REGISTERED, function (realm, registeration) {
    console.log('onRPCRegistered RPC registered', registeration.getUri());
});
app.on(MSG.ON_UNREGISTERED, function (realm, registeration) {
    console.log('onRPCUnregistered RPC unregistered', registeration.getUri());
});
app.on(MSG.REALM_CREATED, function (realm, realmName) {
    console.log('new Relm:', realmName);
});

app.getRealm('realm1', function (realm) {
    var api = realm.api();
    api.register('test.foo', function(id, args, kwargs) {
        console.log('called with ', args, kwargs);
        api.resrpc(id, null /* no error */, ["bar", "bar2"], {"key1": "bar1", "key2": "bar2"});
    });
});

console.log('Listening port:', program.port);
app.listenWAMP({port: program.port});
