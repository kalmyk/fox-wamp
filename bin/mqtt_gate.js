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
    Router = require('../index'),
    program = require('commander');

program
  .option('-p, --wamp <port>', 'WAMP Server IP port', 9000)
  .option('-q, --mqtt <port>', 'MQTT Server IP port', 1883)
  .parse(process.argv);

var app = new Router();

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

console.log('Listening port wamp', program.wamp, 'mqtt',program.mqtt);

app.listenMQTT({port: program.mqtt});
app.listenWAMP({port: program.wamp});
