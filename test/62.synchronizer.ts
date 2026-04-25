import * as chai from 'chai'; const { expect } = chai;
import spies from 'chai-spies'
chai.use(spies)

import Router       from '../lib/router.js'
import { StageOneTask, StageTwoTask } from '../lib/masterfree/synchronizer.js'
import { Event } from '../lib/masterfree/hyper.h.js'
import { BaseRealm } from '../lib/realm.js'
import { HyperClient } from '../lib/hyper/client.js'

describe('62.synchronizer', function () {
  let
    draftStack: any[],
    extractStack: any[],
    resolvedStack: any[],
    api: HyperClient,
    router: Router,
    sysRealm: BaseRealm,
    stageOne: StageOneTask,
    stageTwo: StageTwoTask

  beforeEach(async () => {
    draftStack = []
    extractStack = []
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
    await api.subscribe(Event.ELECT_SEGMENT, (event, opt) => { extractStack.push(event) })

    // stage two
    await api.subscribe(Event.ADVANCE_SEGMENT_RESOLVED, (event, opt) => {
      // console.log('ADVANCE_SEGMENT_RESOLVED', event, opt.headers)
      resolvedStack.push(event)
    })
  })

  afterEach(async () => {})
  
  it('init-seed generateOnce', async () => {
    await api.publish(Event.GENERATE_DRAFT, {advanceOwner:'entry1', advanceSegment:'a0', tag: 'tag0'})
    await api.publish(Event.GENERATE_DRAFT, {advanceOwner:'entry1', advanceSegment:'a0', tag: 'tag1'})
    await api.publish(Event.GENERATE_DRAFT, {advanceOwner:'entry1', advanceSegment:'a1', tag: 'tag2'})
    await api.publish(Event.GENERATE_DRAFT, {advanceOwner:'entry2', advanceSegment:'a0', tag: 'tag3'})

    expect(draftStack).deep.equal([
      {
        advanceOwner: 'entry1',
        advanceSegment: 'a0',
        tag: 'tag0',
        draftId: { dt: 'PREFIX1:', id: 1 },
        draftOwner: 'SYNC1'
      },
      {
        advanceOwner: 'entry1',
        advanceSegment: 'a1',
        tag: 'tag2',
        draftId: { dt: 'PREFIX1:', id: 2 },
        draftOwner: 'SYNC1'
      },
      {
        advanceOwner: 'entry2',
        advanceSegment: 'a0',
        tag: 'tag3',
        draftId: { dt: 'PREFIX1:', id: 3 },
        draftOwner: 'SYNC1'
      }]
    )

    expect(stageOne.getRecentValue()).deep.equal('')
    expect(extractStack).deep.equal([])
  })

  it('stage-one extractDraft', async () => {
    expect(stageOne.getRecentValue()).deep.equal('')
    stageOne.setRecentValue('P:1')

    await api.publish(Event.GENERATE_DRAFT, {advanceOwner:'entry1', advanceSegment:'a1', tag: 'tag1'})
    await api.publish(Event.GENERATE_DRAFT, {advanceOwner:'entry1', advanceSegment:'a2', tag: 'tag2'})

    await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {advanceOwner: 'entry1', advanceSegment: 'a1', tag: 'tag1', draftOwner: 'sync2', draftId: { dt: 'PREFIX1:', id: 2 }})
    await api.publish(Event.PICK_CHALLENGER + '.SYNC1', {advanceOwner: 'entry1', advanceSegment: 'a2', tag: 'tag2', draftOwner: 'sync2', draftId: { dt: 'PREFIX1:', id: 3 }})

    expect(extractStack).deep.equal([
      {
        advanceOwner: "entry1",
        advanceSegment: "a1",
        tag: "tag1",
        voter: "SYNC1",
        challenger: "PREFIX1:a1"
      },
      {
        advanceOwner: "entry1",
        advanceSegment: "a2",
        tag: "tag2",
        voter: "SYNC1",
        challenger: "PREFIX1:a2"
      }
    ])
    expect(stageOne.getRecentValue()).equal('PREFIX1:a2')
  })

  it('stage-two resolve', async () => {

  })

})
