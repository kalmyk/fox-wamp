//
// demo how to register custom function inside the router
//
const MSG = require('../lib/messages')
const Router = require('../index')
const program = require('commander')

program
  .option('-p, --port <port>', 'Server IP port', 9000)
  .parse(process.argv)

const router = new Router()
router.setLogTrace(true)

router.on(MSG.REALM_CREATED, function (realm, realmName) {
  console.log('new Relm:', realmName)

  realm.on(MSG.ON_REGISTERED, function (registeration) {
    console.log('onRPCRegistered RPC registered', registeration.getUri())
  })
  realm.on(MSG.ON_UNREGISTERED, function (registeration) {
    console.log('onRPCUnregistered RPC unregistered', registeration.getUri())
  })
})

const realm = router.getRealm('realm1')
const api = realm.wampApi()
api.register('test.foo', function (id, args, kwargs, opt) {
  console.log('function "test.foo" called with ', args, kwargs, opt)
  api.resrpc(id, null /* no error */, ['bar', 'bar2'], { key1: 'bar1', key2: 'bar2' })
})

console.log('Listening port:', program.port)
router.listenWAMP({ port: program.port })
