import * as chai from 'chai';
const { expect } = chai;
const assert: Chai.AssertStatic = chai.assert;
import spies from 'chai-spies'
import promised from 'chai-as-promised'
chai.use(spies)
chai.use(promised)

import { MemServer } from '../lib/hyper/mem_transport.js'
import { FoxGate }   from '../lib/hyper/gate.js'
import Router        from '../lib/router.js'
import { BaseRealm } from '../lib/realm.js'
import { HyperClient } from '../lib/hyper/client.js'

describe('25.realm_pipe', async () => {
  let
    nextPromise: Array<(value: any) => void>,
    router: Router,
    realm1: BaseRealm,
    realm2: BaseRealm,
    api1: HyperClient & { session: () => any },
    api2: HyperClient & { session: () => any }

  function getNextPackage(): Promise<any> {
    return new Promise((resolve) => {
      nextPromise.push(resolve)
    })
  }

  beforeEach(async () => {
    nextPromise = []
    router = new Router()
    realm1 = await router.getRealm('realm1')
    realm2 = await router.getRealm('realm2')
    api1 = (realm1 as any).api()
    api2 = (realm2 as any).api()

    const memServer = new MemServer(new FoxGate(router))
    const pipeClient = memServer.createClient(realm1)

    await pipeClient.pipe(realm2.buildApi(), 'pubtest')

    await api2.subscribe('pubtest', (event, opt) => {
      if (nextPromise.length > 0) {
        const promiseResolve = nextPromise.shift() as (value: any) => void
        promiseResolve([opt.topic, event, opt.headers])
      } else {
        console.log('pubtest event', event, opt)
      }
    })
  })

  afterEach(async () => {
    assert.isFalse(api1.session().hasSendError(), api1.session().firstSendErrorMessage())
    assert.isFalse(api2.session().hasSendError(), api2.session().firstSendErrorMessage())
  })

  it('pipe-publist', async () => {
    const realm2Event = getNextPackage()

    await api1.publish('pubtest', {info:'pkg'}, { headers: { test: 'value' } })
   
    assert.deepEqual(await realm2Event, ['pubtest', {info:'pkg'}, { test: 'value' }])
  })

})