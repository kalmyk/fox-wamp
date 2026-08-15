import * as chai from 'chai'; const { expect } = chai;
import spies from 'chai-spies'
chai.use(spies)

import { Router } from '../lib/router'
import { StageOneTask, StageTwoTask } from '../lib/masterfree/synchronizer'
import { Event } from '../lib/masterfree/hyper.h'
import { BaseRealm } from '../lib/realm'
import { HyperClient } from '../lib/hyper/client'

describe('62.synchronizer', function () {
  let
    draftStack: any[],
    electSegmentStack: any[],
    resolvedStack: any[],
    api: HyperClient,
    router: Router,
    sysRealm: BaseRealm,
    stageOne: StageOneTask,
    stageTwo: StageTwoTask

  beforeEach(async () => {
    draftStack = []
    electSegmentStack = []
    resolvedStack = []
    router = new Router()
    router.setId('sync1')
    sysRealm = await router.getRealm('sys')
    api = sysRealm.buildApi()

    const MAJOR_LIMIT = 2
    stageOne = new StageOneTask(sysRealm, 'SYNC1', MAJOR_LIMIT, ['SYNC2', 'SYNC3'])
    stageOne.reconcilePos('PREFIX1:', 0)

    stageTwo = new StageTwoTask(sysRealm, MAJOR_LIMIT)

    await api.subscribe(Event.PICK_CHALLENGER + '.SYNC2', (event, opt) => {
      // console.log('PICK_CHALLENGER', event, opt.headers)
      draftStack.push(event)
    })
    await api.subscribe(Event.ELECT_SEGMENT, (event, opt) => { electSegmentStack.push(event) })

    // stage two
    await api.subscribe(Event.ADVANCE_SEGMENT_RESOLVED, (event, opt) => {
      // console.log('ADVANCE_SEGMENT_RESOLVED', event, opt.headers)
      resolvedStack.push(event)
    })
  })

  afterEach(async () => { })

  it('init-seed generateOnce', async () => {
    await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'entry1', advanceStamp: 1, shardTag: 'tag0' })
    await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'entry1', advanceStamp: 1, shardTag: 'tag1' })
    await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'entry1', advanceStamp: 2, shardTag: 'tag2' })
    await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'entry2', advanceStamp: 1, shardTag: 'tag3' })

    expect(draftStack).deep.equal([
      {
        advanceOwner: 'entry1',
        advanceStamp: 1,
        shardTag: 'tag0',
        draftId: { dt: 'PREFIX1:', id: 1 },
        draftOwner: 'SYNC1'
      },
      {
        advanceOwner: 'entry1',
        advanceStamp: 2,
        shardTag: 'tag2',
        draftId: { dt: 'PREFIX1:', id: 2 },
        draftOwner: 'SYNC1'
      },
      {
        advanceOwner: 'entry2',
        advanceStamp: 1,
        shardTag: 'tag3',
        draftId: { dt: 'PREFIX1:', id: 3 },
        draftOwner: 'SYNC1'
      }]
    )

    expect(stageOne.getRecentValue()).deep.equal('')
    expect(electSegmentStack).deep.equal([])
  })

  it('stage-one extractDraft to pass ELECT_SEGMENT to StageTwo', async () => {
    expect(stageOne.getRecentValue()).deep.equal('')
    stageOne.setRecentValue('P:1')

    await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'entry1', advanceStamp: 1, shardTag: 'tag1' })
    await api.publish(Event.GENERATE_DRAFT, { advanceOwner: 'entry1', advanceStamp: 2, shardTag: 'tag2' })

    // Segment 1's PICK_CHALLENGER arrives after segment 2's GENERATE_DRAFT — segment 1 is
    // abandoned by the monotonic recentAdvanceStamp guard and produces no ELECT_SEGMENT.
    await api.publish(Event.PICK_CHALLENGER + '.SYNC1', { advanceOwner: 'entry1', advanceStamp: 1, shardTag: 'tag1', draftOwner: 'sync2', draftId: { dt: 'PREFIX1:', id: 2 } })
    await api.publish(Event.PICK_CHALLENGER + '.SYNC1', { advanceOwner: 'entry1', advanceStamp: 2, shardTag: 'tag2', draftOwner: 'sync2', draftId: { dt: 'PREFIX1:', id: 3 } })

    expect(electSegmentStack).deep.equal([
      {
        advanceOwner: "entry1",
        advanceStamp: 2,
        shardTag: "tag2",
        voter: "SYNC1",
        challenger: "PREFIX1:a2"
      }
    ])

    expect(stageOne.getRecentValue()).equal('PREFIX1:a2')
  })

  it('stage-two resolve', async () => {

  })
})
