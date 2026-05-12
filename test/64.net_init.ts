import * as chai from 'chai'; const { expect } = chai;
import spies from 'chai-spies'
chai.use(spies)

import { Router } from '../lib/router'
import { NetEngineMill } from '../lib/masterfree/netengine'
import { StageOneTask } from '../lib/masterfree/synchronizer'
import { BaseRealm } from '../lib/realm'
import { HyperClient } from '../lib/hyper/client'

describe('64.net_init', function () {
  const syncCluster = ['SYNC_A', 'SYNC_B', 'SYNC_C']

  let
    api: HyperClient,
    router: Router,
    sysRealm: BaseRealm,
    netEngineMill: NetEngineMill

  beforeEach(async () => {
    router = new Router()
    router.setId('entry1')
    netEngineMill = new NetEngineMill(router)
    sysRealm = await router.getRealm('sys')
    api = sysRealm.buildApi()
  })

  it('init-entry handshake from entry node', async () => {
    // create two sync node responders
    const stageA = new StageOneTask(sysRealm, 'SYNC_A', 2, syncCluster)
    stageA.setRecentValue('PREFIX:5')
    const stageB = new StageOneTask(sysRealm, 'SYNC_B', 2, syncCluster)
    stageB.setRecentValue('PREFIX:7')

    // act: simulate passive connections from sync nodes
    // In real system, Sync node connects to Entry and calls listenEntry
    // Here we manually trigger listenEntry to simulate the connection events
    const handshakePromise = netEngineMill.initHandshake(2, 1000)

    // simulate connections
    const entryApiA = sysRealm.buildApi()
    await stageA.listenEntry(entryApiA, 'entry1')
    const entryApiB = sysRealm.buildApi()
    await stageB.listenEntry(entryApiB, 'entry1')

    const result = await handshakePromise

    // assert: resolved value should be undefined (handshake done)
    expect(result).to.be.undefined
    // assert: maxAdvanceId should be the highest recentValue from responders
    expect(netEngineMill.getMaxAdvanceId()).to.equal('PREFIX:7')
  })

  it('init-entry handshake timeout when quorum is not reached', async () => {
    // create only ONE sync node responder
    const stageA = new StageOneTask(sysRealm, 'SYNC_A', 2, syncCluster)
    // stageA.setRecentValue('PREFIX:5')

    // act: netEngineMill initiates handshake with quorum=2, but only 1 responder exists
    try {
      await netEngineMill.initHandshake(2, 50)
      expect.fail('handshake should have timed out')
    } catch (err: any) {
      // assert: should catch timeout error
      expect(err.message).to.equal('initHandshake timeout')
    }
  })

})
