const MSG = require('../lib/messages')
const Router = require('../index')
const program = require('commander')

program
  .option('-p, --wamp <port>', 'WAMP Server IP port', 9000)
  .option('-q, --mqtt <port>', 'MQTT Server IP port', 1883)
  .parse(process.argv)

let app = new Router()
app.setLogTrace(true)

app.on(MSG.REALM_CREATED, function (realm, realmName) {
  console.log('new Relm:', realmName)
})

app.getRealm('realm1', function (realm) {
  var api = realm.api()
  api.register('test.foo', function (id, args, kwargs) {
    console.log('called with ', args, kwargs)
    api.resrpc(id, null /* no error */, ['bar', 'bar2'], { 'key1': 'bar1', 'key2': 'bar2' })
  })
})

console.log('Listening port wamp', program.wamp, 'mqtt', program.mqtt)

app.listenMQTT({ port: program.mqtt })
app.listenWAMP({ port: program.wamp })
