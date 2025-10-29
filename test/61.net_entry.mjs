import chai, { expect } from 'chai'
import spies from 'chai-spies'
chai.use(spies)

import Router from '../lib/router'
import { NetEngine, NetEngineMill } from '../lib/masterfree/netengine'
import { BaseRealm } from '../lib/realm'
import { Config, setConfigInstance } from '../lib/masterfree/config'
import { Event } from '../lib/masterfree/hyper.h'

describe('61.net-entry', function () {
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
  
  it('Event.BEGIN_ADVANCE_SEGMENT', async () => {
    const advanceSegmentStartedPkg = getSysPackage()
    const admanceEventSentPkg = getSysPackage()

    await netApi.publish('any-test-topic', {package:'test'}, {})

    const advanceSegmentStarted = await advanceSegmentStartedPkg
    expect(advanceSegmentStarted.length).equal(2)
    expect(advanceSegmentStarted[0]).equal(Event.BEGIN_ADVANCE_SEGMENT)
    expect(advanceSegmentStarted[1])
      .deep.include({advanceOwner: "E1", advanceSegment: 'E1-1'})

    const admanceEventSent = await admanceEventSentPkg
    expect(admanceEventSent.length).equal(2)
    expect(admanceEventSent[0]).equal(Event.KEEP_ADVANCE_HISTORY)
    delete admanceEventSent[1].shard
    delete admanceEventSent[1].sid
    expect(admanceEventSent[1]).deep.equal({
      advanceId: {
        offset: 1,
        segment: "E1-1"
      },
      data: {
        kv: {
          package: "test"
        }
      },
      opt: {
        "exclude_me": true
      },
      realm: "testnet",
      uri: [
        "any-test-topic"
      ]
    })
    expect(sysStack.length).equal(0)

    await sysApi.publish(Event.TRIM_ADVANCE_SEGMENT + '.E1', {
      advanceOwner: 'E1',
      advanceSegment: 'E1-1'
      },
      {exclude_me: true}
    )

  })

})