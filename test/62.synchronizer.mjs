import chai, { expect } from 'chai'
import spies from 'chai-spies'
chai.use(spies)

import Router       from '../lib/router'
import { StageOneTask } from '../lib/masterfree/synchronizer'
import { Event } from '../lib/masterfree/hyper.h'

describe('62 synchronizer', function () {
  let
    draftStack,
    extractStack,
    api,
    router,
    sysRealm,
    stageOne

  beforeEach(async () => {
    draftStack = []
    extractStack = []
    router = new Router()
    router.setId('sync1')
    sysRealm = await router.getRealm('sys')
    api = sysRealm.buildApi()

    const MAJOR_LIMIT = 2
    stageOne = new StageOneTask(sysRealm, MAJOR_LIMIT)
    stageOne.reconcilePos('PREFIX1:')

    await api.subscribe(Event.DRAFT_SEGMENT, (event, opt) => { 
      // console.log('DRAFT_SEGMENT', event, opt.headers)
      draftStack.push(event)
    })
    await api.subscribe(Event.CHALLENGER_EXTRACT, (event, opt) => { extractStack.push(event) })
  })

  afterEach(async () => {})
  
  it('init-seed generateOnce', async () => {
    await api.publish(Event.GENERATE_SEGMENT, {advanceOwner:'entry1', advanceSegment:'a0'})
    await api.publish(Event.GENERATE_SEGMENT, {advanceOwner:'entry1', advanceSegment:'a0'})
    await api.publish(Event.GENERATE_SEGMENT, {advanceOwner:'entry1', advanceSegment:'a1'})
    await api.publish(Event.GENERATE_SEGMENT, {advanceOwner:'entry2', advanceSegment:'a0'})

    expect(draftStack).deep.equal([
      {
        advanceOwner: 'entry1',
        advanceSegment: 'a0',
        draftId: { dt: 'PREFIX1:', id: 1 },
        draftOwner: 'sync1'
      },
      {
        advanceOwner: 'entry1',
        advanceSegment: 'a1',
        draftId: { dt: 'PREFIX1:', id: 2 },
        draftOwner: 'sync1'
      },
      {
        advanceOwner: 'entry2',
        advanceSegment: 'a0',
        draftId: { dt: 'PREFIX1:', id: 3 },
        draftOwner: 'sync1'
      }]
    )

    expect(stageOne.getRecentValue()).deep.equal('')
    expect(extractStack).deep.equal([])
  })

  it('stage-one extractDraft', async () => {
    expect(stageOne.getRecentValue()).deep.equal('')
    stageOne.setRecentValue('P:1')

    await api.publish(Event.GENERATE_SEGMENT, {advanceOwner:'entry1', advanceSegment:'a1'})
    await api.publish(Event.GENERATE_SEGMENT, {advanceOwner:'entry1', advanceSegment:'a2'})

    await api.publish(Event.DRAFT_SEGMENT, {advanceOwner: 'entry1', advanceSegment: 'a1', draftOwner: 'sync2', draftId: { dt: 'PREFIX1:', id: 2 }})
    await api.publish(Event.DRAFT_SEGMENT, {advanceOwner: 'entry1', advanceSegment: 'a2', draftOwner: 'sync2', draftId: { dt: 'PREFIX1:', id: 3 }})

    expect(extractStack).deep.equal([
      {
        advanceOwner: "entry1",
        advanceSegment: "a1",
        challenger: "PREFIX1:a1"
      },
      {
        advanceOwner: "entry1",
        advanceSegment: "a2",
        challenger: "PREFIX1:a2"
      }
    ])
    expect(stageOne.getRecentValue()).equal('PREFIX1:a2')
  })

  // it('stage-one extract', async () => {
  //   stageOne.emit(SO_ON_ID_PAIR, 'vouter1', 'topic1', 'a1')
  //   stageOne.emit(SO_ON_ID_PAIR, 'vouter2', 'topic2', 'a1')

  //   stageOne.emit(SO_ON_ID_PAIR, 'vouter1', 'topic2', 'a2')
  //   assert.deepEqual(extractHistory.shift(), ['topic2','a1'])
  //   assert.equal(stageOne.getRecentValue(), 'a1')

  //   // vote for closed topic
  //   stageOne.emit(SO_ON_ID_PAIR, 'vouter3', 'topic2', 'a3')
  //   assert.equal(extractHistory.shift(), undefined)
  //   assert.equal(stageOne.getRecentValue(), 'a2')

  //   // value is taken from recent vote
  //   stageOne.emit(SO_ON_ID_PAIR, 'vouter2', 'topic1', 'a2')
  //   assert.deepEqual(extractHistory.shift(), ['topic1','a3'])
  //   assert.equal(stageOne.getRecentValue(), 'a3')
  // })

})
