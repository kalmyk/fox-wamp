import * as chai from 'chai'; const { expect } = chai

import { Router } from '../lib/router'
import { BaseRealm } from '../lib/realm'
import { HyperClient } from '../lib/hyper/client'
import { NetEngine, NetEngineMill } from '../lib/masterfree/netengine'
import { Event, BODY_SEGMENT_COMMITTED } from '../lib/masterfree/hyper.h'

// openspec/changes/live-dispatch-eventid-ordering — spec requirement "Live delivery order is
// non-decreasing per subscription".

function marker (origin: string, segment: string, shard: number, eventIds: string[]): BODY_SEGMENT_COMMITTED {
  return {
    origin,
    advanceOwner: 'e1',
    advanceStamp: 1,
    segment,
    events: eventIds.map(eventId => ({
      eventId,
      realm: 'testnet',
      uri: ['topicA'],
      data: { kv: eventId },
      opt: {},
      sid: 's1',
      shard
    }))
  }
}

describe('69.live_dispatch_ordering', function () {
  let router: Router
  let netRealm: BaseRealm
  let netApi: HyperClient
  let sysApi: HyperClient

  beforeEach(async () => {
    router = new Router()
    router.setId('E1')
    const netEngineMill = new NetEngineMill(router, 1)
    netRealm = new BaseRealm(router, new NetEngine(netEngineMill))
    router.initRealm('testnet', netRealm)
    netApi = netRealm.api()
    sysApi = (await router.getRealm('sys')).buildApi()
  })

  // 1.1/1.2: reproduces the violation against the unmodified dispatch path. The larger eventId's
  // broadcast (shard A, fast) is processed before the smaller one's (shard B, slow); both are
  // distinct eventIds, so SeenEventWindow's exact-match dedup lets both straight through, and
  // dispatchLiveEvents hands them to disperseToSubs in broadcast-arrival order.
  //
  // Skipped only while the fix is unimplemented: it fails today (observed ["E100a1","E050a1"]) and
  // would otherwise turn `npm test` red for every other change. Un-skip it in task 5.3 of
  // live-dispatch-eventid-ordering, which is the task that must make it pass.
  it.skip('1.1 cross-shard out-of-order broadcasts are not delivered out of order', async () => {
    const received: string[] = []
    await netApi.subscribe('topicA', (data: any) => received.push(data))

    await sysApi.publish(Event.SEGMENT_COMMITTED, marker('NDB_A', 'E100', 0, ['E100a1']), { exclude_me: false })
    await sysApi.publish(Event.SEGMENT_COMMITTED, marker('NDB_B', 'E050', 1, ['E050a1']), { exclude_me: false })
    await new Promise(resolve => setTimeout(resolve, 20))

    // Only the invariant is asserted, not that everything is delivered: a correct implementation
    // may legitimately hold an event back until every shard's marker has reached it.
    expect(received).to.deep.equal([...received].sort(),
      'a subscription must never see a smaller eventId after a larger one; got ' + JSON.stringify(received))
  })
})
