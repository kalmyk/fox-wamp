import * as chai from 'chai'; const { expect } = chai;
import spies from 'chai-spies'
chai.use(spies)

import { Router } from '../lib/router'
import { NetEngineMill } from '../lib/masterfree/netengine'
import { StageOneTask } from '../lib/masterfree/synchronizer'
import { BaseRealm } from '../lib/realm'
import { HyperClient } from '../lib/hyper/client'

describe('64.net_init', function () {
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
    const syncCluster = ['SYNC_A', 'SYNC_B', 'SYNC_C']
    // create two sync node responders
    const stageA = new StageOneTask(sysRealm, 'SYNC_A', 2, syncCluster)
    stageA.setRecentValue('PREFIX:5')
    const stageB = new StageOneTask(sysRealm, 'SYNC_B', 2, syncCluster)
    stageB.setRecentValue('PREFIX:7')

    // allow stage nodes to finish subscribing
    await new Promise(r => setTimeout(r, 100))
    // act: netEngineMill initiates handshake with quorum=2
    const result = await netEngineMill.initHandshake(2, 1000)

    // assert: resolved value should be undefined (handshake done)
    expect(result).to.be.undefined
    // assert: maxAdvanceId should be the highest recentValue from responders
    expect(netEngineMill.getMaxAdvanceId()).to.equal('PREFIX:7')
  })

  it('init-entry handshake timeout when quorum is not reached', async () => {
    // create only ONE sync node responder
    const stageA = new StageOneTask(sysRealm, 'SYNC_A', 2, ['SYNC_B'])
    stageA.setRecentValue('PREFIX:5')

    // allow stage node to finish subscribing
    await new Promise(r => setTimeout(r, 10))

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
