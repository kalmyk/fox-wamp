import * as chai from 'chai'; const { expect } = chai;
import spies from 'chai-spies'
chai.use(spies)

import { Router } from '../lib/router'
import { NetEngine, NetEngineMill, INIT_ADVANCE_SEGMENTS_COMPLETED } from '../lib/masterfree/netengine'
import { BaseRealm } from '../lib/realm'
import { Config, setConfigInstance } from '../lib/masterfree/config'
import { Event } from '../lib/masterfree/hyper.h'
import { HyperClient } from '../lib/hyper/client'
import { StageOneTask } from '../lib/masterfree/synchronizer'

describe('61.net-entry', function () {
  let
    nextSysPromise: Array<(value: any) => void>,
    sysRealm: BaseRealm,
    netRealm: BaseRealm,
    router: Router,
    netEngineMill: NetEngineMill,
    sysApi: HyperClient,
    sysStack: any[],
    netApi: HyperClient

  function getSysPackage(): Promise<any> {
    return new Promise((resolve) => {
      nextSysPromise.push(resolve)
    })
  }

  beforeEach(async () => {
    setConfigInstance(new Config())

    nextSysPromise = []
    router = new Router()
    router.setId('E1')
    netEngineMill = new NetEngineMill(router, 2)

    netRealm = new BaseRealm(router, new NetEngine(netEngineMill))
    netApi = netRealm.api()
    router.initRealm('testnet', netRealm)

    sysStack = []
    sysRealm = await router.getRealm('sys')
    sysApi = sysRealm.api()
    sysApi.subscribe('*', (event, opt) => {
      if (nextSysPromise.length > 0) {
        const promiseResolve = nextSysPromise.shift() as (value: any) => void
        promiseResolve([opt.topic, event])
      } else {
        sysStack.push([opt.topic, event])
      }
    })
  })

  afterEach(async () => { })

  const syncCluster = ['SYNC_A', 'SYNC_B', 'SYNC_C']

  it('init-entry handshake from entry node', async () => {
    const handshakePromise = new Promise((resolve) => {
      netEngineMill.once(INIT_ADVANCE_SEGMENTS_COMPLETED, resolve)
    })

    // create two sync node responders
    const stageA = new StageOneTask(sysRealm, 'SYNC_A', 2, syncCluster)
    stageA.getAdvanceOwnerState('E1').recentAdvanceStamp = 5
    const stageB = new StageOneTask(sysRealm, 'SYNC_B', 2, syncCluster)
    stageB.getAdvanceOwnerState('E1').recentAdvanceStamp = 7

    // simulate connections
    const entryApiA = sysRealm.buildApi()
    await stageA.listenEntry(entryApiA, 'E1')
    const entryApiB = sysRealm.buildApi()
    await stageB.listenEntry(entryApiB, 'E1')

    await handshakePromise

    // assert: maxAdvanceId should be the highest recentValue from responders
    expect(netEngineMill.getRecentAdvanceSegment()).to.lessThanOrEqual(Date.now())
  })

  it('Event.BEGIN_ADVANCE_SEGMENT', async () => {
    const advanceStampStartedPkg = getSysPackage()
    const admanceEventSentPkg = getSysPackage()

    await netApi.publish('any-test-topic', { package: 'test' }, {})

    const advanceStampStarted = await advanceStampStartedPkg
    expect(advanceStampStarted.length).equal(2)
    expect(advanceStampStarted[0]).equal(Event.BEGIN_ADVANCE_SEGMENT)
    expect(advanceStampStarted[1])
      .deep.include({ advanceOwner: "E1", advanceStamp: netEngineMill.getRecentAdvanceSegment() })

    const admanceEventSent = await admanceEventSentPkg
    expect(admanceEventSent.length).equal(2)
    expect(admanceEventSent[0]).equal(Event.KEEP_ADVANCE_HISTORY)
    delete admanceEventSent[1].shard
    delete admanceEventSent[1].sid
    expect(admanceEventSent[1]).deep.equal({
      advanceOwner: 'E1',
      advanceId: {
        segment: netEngineMill.getRecentAdvanceSegment(),
        offset: 1
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
      advanceStamp: 1
    },
      { exclude_me: true }
    )

  })

})