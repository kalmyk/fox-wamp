import chai, { expect, assert } from 'chai'
import spies from 'chai-spies'
import promised from 'chai-as-promised'
chai.use(spies)
chai.use(promised)

import { MemServer } from '../lib/hyper/mem_transport'
import { FoxGate }   from '../lib/hyper/gate'
import FoxRouter        from '../lib/fox_router'

describe('25.realm_pipe', async () => {
  let
    nextPromise,
    router,
    realm1,
    realm2,
    api1,
    api2

  function getNextPackage() {
    return new Promise((resolve, reject) => {
      nextPromise.push(resolve)
    })
  }

  beforeEach(async () => {
    nextPromise = []
    router = new FoxRouter()
    realm1 = await router.getRealm('realm1')
    realm2 = await router.getRealm('realm2')
    api1 = realm1.buildApi()
    api2 = realm2.buildApi()

    api2.subscribe('pubtest', (event, opt) => {
      console.log('pubtest event', event, opt)
      if (nextPromise.length > 0) {
        const promiseResolve = nextPromise.shift()
        promiseResolve([opt.topic, event])
      } else {
      }
    })

    const memServer = new MemServer(new FoxGate(router))
    const pipeClient = memServer.createClient(realm2)
    api1.pipe(pipeClient, 'pubtest')
  })

  afterEach(async () => {
    assert.isFalse(api1.session().hasSendError(), api1.session().firstSendErrorMessage())
    assert.isFalse(api2.session().hasSendError(), api2.session().firstSendErrorMessage())
  })

  it('pipe-publist', async () => {
    // const realm2Event = getNextPackage()
    // await api1.publish('pubtest', {info:'pkg'}, { headers: { test: 'value' } })
    // console.log('realm1Eventawait', await realm2Event);    
  })

})