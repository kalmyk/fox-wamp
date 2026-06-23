import * as MSG from '../lib/messages'
import FoxRouter from '../lib/fox_router'
import { BaseRealm } from '../lib/realm'
import program from 'commander'

program
  .option('-p, --port <port>', 'Server IP port', '9000')
  .parse(process.argv)

const router = new FoxRouter()
router.setLogTrace(true)

router.on(MSG.REALM_CREATED, (realm: BaseRealm, realmName: string) => {
  console.log('new Realm:', realmName)

  realm.on(MSG.ON_REGISTERED, (registration: any) => {
    console.log('onRPCRegistered RPC registered', registration.getUri())
  })
  realm.on(MSG.ON_UNREGISTERED, (registration: any) => {
    console.log('onRPCUnregistered RPC unregistered', registration.getUri())
  })
})

router.getRealm('realm1', (realm: BaseRealm) => {
  const api = realm.api()

  api.register('test.foo', (args: any, opt: any) => {
    console.log('function "test.foo" called with', args, opt)
    return Promise.resolve({ key1: 'bar1', headers: opt.headers })
  })

  console.log('Listening port:', program.port)
  router.listenWAMP({ port: program.port })
})
