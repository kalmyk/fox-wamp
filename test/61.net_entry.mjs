import chai, { expect } from 'chai'
import spies from 'chai-spies'
chai.use(spies)

import Router from '../lib/router'
import { NetEngine, NetEngineMill } from '../lib/masterfree/netengine'
import { BaseRealm } from '../lib/realm'
import { Config, setConfigInstance } from '../lib/masterfree/config'

describe('61 net-entry', function () {
  let
    nextSysPromise,
    sysRealm,
    netRealm,
    router,
    netEngineMill,
    sysApi,
    sysStack,
    netApi

  function getSysPackage() {
    return new Promise((resolve, reject) => {
      nextSysPromise.push(resolve)
    })
  }

  beforeEach(async () => {
    setConfigInstance(new Config({}))

    nextSysPromise = []
    router = new Router()
    router.setId('E1')
    netEngineMill = new NetEngineMill(router)

    netRealm = new BaseRealm(router, new NetEngine(netEngineMill))
    netApi = netRealm.api()
    router.initRealm('testnet', netRealm)

    sysStack = []
    sysRealm = await router.getRealm('sys')
    sysApi = sysRealm.api()
    sysApi.subscribe('*', (event, opt) => {
      if (nextSysPromise.length > 0) {
        const promiseResolve = nextSysPromise.shift()
        promiseResolve([opt.topic, event])
      } else {
        sysStack.push([opt.topic, event])
      }
    })
  })

  afterEach(async () => {})
  
  it('begin-advance-segment', async () => {
    const advanceSegmentStarted = getSysPackage()
    const admanceEventSent = getSysPackage()

    await netApi.publish('any-test-topic', {data:'test'}, {})
    expect(await advanceSegmentStarted).deep.equal(['begin-advance-segment',{advanceSegment: 'E1-1'}])
    expect(await admanceEventSent).deep.equal(['keep-advance-history',null])
    expect(sysStack.length).equal(0)
  })

})