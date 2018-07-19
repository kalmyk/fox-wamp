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

var 
    MSG = require('../lib/messages'),
    MqttTransport = require('../lib/mqtt/transport'),
    WampRouter = require('../lib/fox-wamp'),
    program = require('commander');

program
  .option('-p, --port <port>', 'Server IP port', 9000)
  .parse(process.argv);

console.log('Listening port:', program.port);

//
// WebSocket server
//
var app = new WampRouter(
    {port: program.port}
);

MqttTransport.listen(app, {port: 1883});

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
